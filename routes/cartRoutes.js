const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Product = require('../models/Product');
const Package = require('../models/Package');
const Coupon = require('../models/Coupon');
const { protect } = require('../middleware/authMiddleware');

// @desc    Get user cart
// @route   GET /api/cart
// @access  Private
router.get('/', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate('cart.product')
            .populate('cart.package');
        
        let subtotal = 0;
        const cartItems = user.cart.map(item => {
            if (item.product) {
                const itemTotal = item.product.price * item.quantity;
                subtotal += itemTotal;
                return item;
            } else if (item.package) {
                const itemTotal = item.package.price * item.quantity;
                subtotal += itemTotal;
                return item;
            }
            return null;
        }).filter(Boolean);

        let discountAmount = 0;
        let couponDetails = null;

        if (user.cartCoupon) {
            const coupon = await Coupon.findOne({ code: user.cartCoupon });
            if (coupon && coupon.isActive) {
                // Validate usage limit if it exists
                if (coupon.maxUsage !== null && coupon.usedCount >= coupon.maxUsage) {
                    // Coupon expired/limit reached - Remove it
                    user.cartCoupon = null;
                    await user.save();
                } else {
                    couponDetails = {
                        code: coupon.code,
                        discountPercentage: coupon.discountPercentage
                    };

                    cartItems.forEach(item => {
                        let applies = false;
                        let price = 0;

                        if (item.product) {
                            price = item.product.price;
                            if (coupon.applicableProducts.length === 0 || 
                                coupon.applicableProducts.map(p => p.toString()).includes(item.product._id.toString())) {
                                applies = true;
                            }
                        } else if (item.package) {
                            price = item.package.price;
                             if (coupon.applicablePackages.length === 0 || 
                                coupon.applicablePackages.map(p => p.toString()).includes(item.package._id.toString())) {
                                applies = true;
                            }
                        }

                        if (applies) {
                            const itemTotal = price * item.quantity;
                            const itemDiscount = (itemTotal * coupon.discountPercentage) / 100;
                            discountAmount += itemDiscount;
                        }
                    });

                    // Cap discount if maxDiscountValue is set
                    if (coupon.maxDiscountValue !== null && discountAmount > coupon.maxDiscountValue) {
                        discountAmount = coupon.maxDiscountValue;
                    }
                }
            } else {
                 // Invalid/Inactive coupon - Remove it
                 user.cartCoupon = null;
                 await user.save();
            }
        }

        const total = Math.max(0, subtotal - discountAmount);

        res.json({ 
            cart: user.cart, 
            subtotal: Number(subtotal.toFixed(2)),
            discountAmount: Number(discountAmount.toFixed(2)),
            total: Number(total.toFixed(2)),
            coupon: couponDetails
        });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// @desc    Add item to cart
// @route   POST /api/cart
// @access  Private
router.post('/', protect, async (req, res) => {
    const { productId, packageId, quantity } = req.body;

    if (!productId && !packageId) {
        return res.status(400).json({ message: 'Must provide productId or packageId' });
    }

    try {
        const user = await User.findById(req.user._id);
        let newQuantity = quantity || 1;

        if (productId) {
            const product = await Product.findById(productId);
            if (!product) return res.status(404).json({ message: 'Product not found' });
            
            const cartItemIndex = user.cart.findIndex(item => item.product && item.product.toString() === productId);
            
            if (cartItemIndex > -1) {
                newQuantity += user.cart[cartItemIndex].quantity;
            }

            if (newQuantity > product.stock) {
                return res.status(400).json({ message: `Not enough stock. Available: ${product.stock}` });
            }

            if (cartItemIndex > -1) {
                user.cart[cartItemIndex].quantity = newQuantity;
            } else {
                user.cart.push({ product: productId, quantity: quantity || 1 });
            }
        } else if (packageId) {
            const pkg = await Package.findById(packageId);
            if (!pkg) return res.status(404).json({ message: 'Package not found' });

            const cartItemIndex = user.cart.findIndex(item => item.package && item.package.toString() === packageId);

            if (cartItemIndex > -1) {
                newQuantity += user.cart[cartItemIndex].quantity;
            }

            if (newQuantity > pkg.stock) {
                return res.status(400).json({ message: `Not enough stock. Available: ${pkg.stock}` });
            }

            if (cartItemIndex > -1) {
                user.cart[cartItemIndex].quantity = newQuantity;
            } else {
                user.cart.push({ package: packageId, quantity: quantity || 1 });
            }
        }

        await user.save();
        const updatedUser = await User.findById(req.user._id).populate('cart.product').populate('cart.package');
        res.json(updatedUser.cart);
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// @desc    Update cart item quantity
// @route   PUT /api/cart/:itemId
// @access  Private
router.put('/:itemId', protect, async (req, res) => {
    const { quantity } = req.body;
    const { itemId } = req.params;

    try {
        const user = await User.findById(req.user._id);
        
        // Try finding by product ID match
        let cartItemIndex = user.cart.findIndex(item => item.product && item.product.toString() === itemId);
        let isPackage = false;

        // If not found, try finding by package ID match
        if (cartItemIndex === -1) {
            cartItemIndex = user.cart.findIndex(item => item.package && item.package.toString() === itemId);
            if (cartItemIndex > -1) isPackage = true;
        }

        if (cartItemIndex > -1) {
            let stock = 0;
            if (isPackage) {
                const pkg = await Package.findById(itemId);
                stock = pkg.stock;
            } else {
                const product = await Product.findById(itemId);
                stock = product.stock;
            }
            
            // req.body.quantity is now the delta (change amount)
            const changeAmount = parseInt(quantity);
            const currentQuantity = user.cart[cartItemIndex].quantity;
            let newQuantity = currentQuantity + changeAmount;
            let message = null;

            // Check if quantity goes below 1
            if (newQuantity < 1) {
                return res.status(400).json({ message: "Quantity can't go lower than one" });
            }

            // Check if quantity exceeds stock
            if (newQuantity > stock) {
                 newQuantity = stock;
                 message = "Quantity updated to maximum available stock";
            }

            // Update quantity
            user.cart[cartItemIndex].quantity = newQuantity;

            await user.save();
            const updatedUser = await User.findById(req.user._id).populate('cart.product').populate('cart.package');
            
            if (message) {
                res.json({ cart: updatedUser.cart, message });
            } else {
                res.json(updatedUser.cart);
            }
        } else {
            res.status(404).json({ message: 'Item not found in cart' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// @desc    Remove item from cart
// @route   DELETE /api/cart/:itemId
// @access  Private
router.delete('/:itemId', protect, async (req, res) => {
     const { itemId } = req.params;

     try {
         const user = await User.findById(req.user._id);
         user.cart = user.cart.filter(item => {
             const prodId = item.product ? item.product.toString() : null;
             const pkgId = item.package ? item.package.toString() : null;
             return prodId !== itemId && pkgId !== itemId;
         });

         await user.save();
         const updatedUser = await User.findById(req.user._id).populate('cart.product').populate('cart.package');
         res.json(updatedUser.cart);
     } catch (error) {
         res.status(500).json({ message: 'Server Error', error: error.message });
     }
});

// @desc    Clear cart
// @route   DELETE /api/cart
// @access  Private
router.delete('/', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        user.cart = [];
        await user.save();
        res.json({ message: 'Cart cleared' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// @desc    Apply coupon to cart
// @route   POST /api/cart/apply-coupon
// @access  Private
router.post('/apply-coupon', protect, async (req, res) => {
    const { code } = req.body;

    try {
        const coupon = await Coupon.findOne({ code });

        if (!coupon) {
            return res.status(404).json({ message: 'Coupon not found' });
        }

        if (!coupon.isActive) {
            return res.status(400).json({ message: 'Coupon is not active' });
        }

        if (coupon.maxUsage !== null && coupon.usedCount >= coupon.maxUsage) {
            return res.status(400).json({ message: 'Coupon usage limit reached' });
        }

        const user = await User.findById(req.user._id);

        // Check if coupon.applicableProducts has items
        if ((coupon.applicableProducts && coupon.applicableProducts.length > 0) || 
            (coupon.applicablePackages && coupon.applicablePackages.length > 0)) {
            
            // Check if cart has at least one of these products OR packages
            const cartProductIds = user.cart.map(item => item.product ? item.product.toString() : null).filter(Boolean);
            const cartPackageIds = user.cart.map(item => item.package ? item.package.toString() : null).filter(Boolean);
            
            const applicableProductIds = coupon.applicableProducts.map(p => p.toString());
            const applicablePackageIds = coupon.applicablePackages.map(p => p.toString());
            
            const hasApplicableProduct = cartProductIds.some(id => applicableProductIds.includes(id));
            const hasApplicablePackage = cartPackageIds.some(id => applicablePackageIds.includes(id));

            if (!hasApplicableProduct && !hasApplicablePackage) {
                return res.status(400).json({ message: 'Coupon not applicable to items in cart' });
            }
        }

        user.cartCoupon = code;
        await user.save();

        res.json({ message: 'Coupon applied successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// @desc    Remove coupon from cart
// @route   POST /api/cart/remove-coupon
// @access  Private
router.post('/remove-coupon', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        user.cartCoupon = null;
        await user.save();

        res.json({ message: 'Coupon removed successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

module.exports = router;

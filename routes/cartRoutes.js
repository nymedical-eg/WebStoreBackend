const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const { protect } = require('../middleware/authMiddleware');

// @desc    Get user cart
// @route   GET /api/cart
// @access  Private
router.get('/', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate('cart.product');
        
        let subtotal = 0;
        const cartItems = user.cart.map(item => {
            if (item.product) {
                const itemTotal = item.product.price * item.quantity;
                subtotal += itemTotal;
                return item;
            }
            return null; // Should ideally filter these out
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
                        // Check if coupon applies to this product
                        if (coupon.applicableProducts.length === 0 || 
                            coupon.applicableProducts.map(p => p.toString()).includes(item.product._id.toString())) {
                            
                            const itemTotal = item.product.price * item.quantity;
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
    const { productId, quantity } = req.body;

    try {
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const user = await User.findById(req.user._id);

        // Check if product already in cart
        const cartItemIndex = user.cart.findIndex(item => item.product.toString() === productId);

        let newQuantity = quantity || 1;
        if (cartItemIndex > -1) {
            newQuantity += user.cart[cartItemIndex].quantity;
        }

        if (newQuantity > product.stock) {
            return res.status(400).json({ message: `Not enough stock. Available: ${product.stock}` });
        }

        if (cartItemIndex > -1) {
            // Product exists in cart, update quantity
            user.cart[cartItemIndex].quantity = newQuantity;
        } else {
            // Add new product to cart
            user.cart.push({ product: productId, quantity: quantity || 1 });
        }

        await user.save();
        const updatedUser = await User.findById(req.user._id).populate('cart.product');
        res.json(updatedUser.cart);
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// @desc    Update cart item quantity
// @route   PUT /api/cart/:itemId
// @access  Private
router.put('/:productId', protect, async (req, res) => {
    const { quantity } = req.body;
    const { productId } = req.params;

    try {
        const user = await User.findById(req.user._id);
        const cartItemIndex = user.cart.findIndex(item => item.product.toString() === productId);

        if (cartItemIndex > -1) {
            const product = await Product.findById(productId);
            
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
            if (newQuantity > product.stock) {
                 newQuantity = product.stock;
                 message = "Quantity updated to maximum available stock";
            }

            // Update quantity
            user.cart[cartItemIndex].quantity = newQuantity;

            await user.save();
            const updatedUser = await User.findById(req.user._id).populate('cart.product');
            
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
router.delete('/:productId', protect, async (req, res) => {
     const { productId } = req.params;

     try {
         const user = await User.findById(req.user._id);
         user.cart = user.cart.filter(item => item.product.toString() !== productId);

         await user.save();
         const updatedUser = await User.findById(req.user._id).populate('cart.product');
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

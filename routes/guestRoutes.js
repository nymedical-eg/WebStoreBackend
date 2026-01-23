const express = require('express');
const router = express.Router();
require('dotenv').config();
const nodemailer = require('nodemailer');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Package = require('../models/Package');
const Coupon = require('../models/Coupon');

// Setup Nodemailer transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// @desc    Calculate cart totals (Guest)
// @route   POST /api/guest/calculate-cart
// @access  Public
router.post('/calculate-cart', async (req, res) => {
    const { items, couponCode } = req.body;

    if (!items || !Array.isArray(items)) {
        return res.status(400).json({ message: 'Items array is required' });
    }

    try {
        let subtotal = 0;
        const calculatedItems = [];

        // 1. Calculate Subtotal & Validate Stock
        for (const item of items) {
            if (item.productId) {
                const product = await Product.findById(item.productId);
                if (!product) {
                    return res.status(404).json({ message: `Product not found: ${item.productId}` });
                }
                if (item.quantity > product.stock) {
                    return res.status(400).json({ 
                        message: `Not enough stock for product: ${product.name}. Available: ${product.stock}` 
                    });
                }
                const itemTotal = product.price * item.quantity;
                subtotal += itemTotal;
                calculatedItems.push({
                    product: product,
                    quantity: item.quantity,
                    price: product.price,
                    type: 'product'
                });
            } else if (item.packageId) {
                const pkg = await Package.findById(item.packageId);
                if (!pkg) {
                    return res.status(404).json({ message: `Package not found: ${item.packageId}` });
                }
                if (item.quantity > pkg.stock) {
                    return res.status(400).json({ 
                        message: `Not enough stock for package: ${pkg.name}. Available: ${pkg.stock}` 
                    });
                }
                const itemTotal = pkg.price * item.quantity;
                subtotal += itemTotal;
                calculatedItems.push({
                    package: pkg,
                    quantity: item.quantity,
                    price: pkg.price,
                    type: 'package'
                });
            }
        }

        // 2. Apply Coupon
        let discountAmount = 0;
        let couponDetails = null;

        if (couponCode) {
            const coupon = await Coupon.findOne({ code: couponCode });
            
            if (coupon && coupon.isActive) {
                 if (coupon.maxUsage !== null && coupon.usedCount >= coupon.maxUsage) {
                     return res.status(400).json({ message: 'coupon has been used up' });
                 }

                 // Calculate potential discount
                 calculatedItems.forEach(item => {
                     let applies = false;
                     if (item.type === 'product') {
                         if (coupon.applicableProducts.length === 0 || 
                             coupon.applicableProducts.map(p => p.toString()).includes(item.product._id.toString())) {
                             applies = true;
                         }
                     } else if (item.type === 'package') {
                          if (coupon.applicablePackages.length === 0 || 
                             coupon.applicablePackages.map(p => p.toString()).includes(item.package._id.toString())) {
                             applies = true;
                         }
                     }

                     if (applies) {
                         const itemTotal = item.price * item.quantity;
                         const itemDiscount = (itemTotal * coupon.discountPercentage) / 100;
                         discountAmount += itemDiscount;
                     }
                 });

                 // Verify Applicability
                 if (discountAmount === 0 && (coupon.applicableProducts.length > 0 || coupon.applicablePackages.length > 0)) {
                      return res.status(400).json({ message: 'Coupon not applicable to items in cart' });
                 }

                 if (coupon.maxDiscountValue !== null && discountAmount > coupon.maxDiscountValue) {
                     discountAmount = coupon.maxDiscountValue;
                 }

                 couponDetails = {
                     code: coupon.code,
                     discountPercentage: coupon.discountPercentage,
                     discountAmount: Number(discountAmount.toFixed(2))
                 };
            } else {
                 return res.status(400).json({ message: 'Invalid or inactive coupon' });
            }
        }

        const total = Math.max(0, subtotal - discountAmount);

        res.json({
            subtotal: Number(subtotal.toFixed(2)),
            discountAmount: Number(discountAmount.toFixed(2)),
            total: Number(total.toFixed(2)),
            coupon: couponDetails
        });

    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// @desc    Create new guest order
// @route   POST /api/guest/order
// @access  Public
router.post('/order', async (req, res) => {
    try {
        const { guestInfo, items, couponCode } = req.body;
        let orderItems = [];
        let customerEmail = '';
        let customerName = '';
        let customerPhone = '';
        let customerAddress = '';
        let usedCouponCode = null;

        if (!guestInfo || !items || items.length === 0) {
            return res.status(400).json({ message: 'Guest order requires guestInfo and items' });
        }

        // Fetch prices from DB based on IDs sent
        for (const item of items) {
            if (item.productId) {
                const product = await Product.findById(item.productId);
                if (!product) return res.status(404).json({ message: `Product not found: ${item.productId}` });
                orderItems.push({
                    product: product._id,
                    quantity: item.quantity,
                    price: product.price,
                    name: product.name,
                    type: 'product'
                });
            } else if (item.packageId) {
                const pkg = await Package.findById(item.packageId);
                if (!pkg) return res.status(404).json({ message: `Package not found: ${item.packageId}` });
                orderItems.push({
                    package: pkg._id,
                    quantity: item.quantity,
                    price: pkg.price,
                    name: pkg.name,
                    type: 'package'
                });
            }
        }

        customerEmail = guestInfo.email;
        customerName = `${guestInfo.firstName} ${guestInfo.lastName}`;
        customerPhone = guestInfo.phone;
        customerAddress = `${guestInfo.address}, ${guestInfo.city}, ${guestInfo.governorate}`;
        usedCouponCode = couponCode;

        // Validate stock for all items
        for (const item of orderItems) {
            if (item.type === 'product') {
                const product = await Product.findById(item.product);
                if (product.stock < item.quantity) {
                    return res.status(400).json({ message: `Not enough stock for product: ${product.name}. Available: ${product.stock}` });
                }
            } else if (item.type === 'package') {
                const pkg = await Package.findById(item.package).populate('includedProducts');
                if (pkg.stock < item.quantity) {
                    return res.status(400).json({ message: `Not enough stock for package: ${pkg.name}. Available: ${pkg.stock}` });
                }
                for (const prod of pkg.includedProducts) {
                    const currentProd = await Product.findById(prod._id);
                    if (currentProd.stock < item.quantity) {
                         return res.status(400).json({ message: `Not enough stock for included product: ${currentProd.name} (in package ${pkg.name}). Available: ${currentProd.stock}` });
                    }
                }
            }
        }

        const totalAmount = orderItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        let finalAmount = totalAmount;
        let couponAppliedData = null;

        // Apply Coupon
        if (usedCouponCode) {
            const coupon = await Coupon.findOne({ code: usedCouponCode });
            
            if (coupon && coupon.isActive) {
                 if (coupon.maxUsage !== null && coupon.usedCount >= coupon.maxUsage) {
                     return res.status(400).json({ message: 'coupon has been used up' });
                 } else {
                     let discountAmount = 0;
                     orderItems.forEach(item => {
                         let applies = false;
                         if (item.type === 'product') {
                             if (coupon.applicableProducts.length === 0 || 
                                 coupon.applicableProducts.map(p => p.toString()).includes(item.product.toString())) {
                                 applies = true;
                             }
                         } else if (item.type === 'package') {
                              if (coupon.applicablePackages.length === 0 || 
                                 coupon.applicablePackages.map(p => p.toString()).includes(item.package.toString())) {
                                 applies = true;
                             }
                         }

                         if (applies) {
                             const itemTotal = item.price * item.quantity;
                             const itemDiscount = (itemTotal * coupon.discountPercentage) / 100;
                             discountAmount += itemDiscount;
                         }
                     });

                     if (coupon.maxDiscountValue !== null && discountAmount > coupon.maxDiscountValue) {
                         discountAmount = coupon.maxDiscountValue;
                     }

                     finalAmount = Math.max(0, totalAmount - discountAmount);
                     couponAppliedData = {
                         code: coupon.code,
                         discountAmount: Number(discountAmount.toFixed(2))
                     };

                     coupon.usedCount += 1;
                     await coupon.save();
                 }
            }
        }

        const order = new Order({
            user: null, 
            guestInfo: guestInfo,
            products: orderItems.map(item => {
                if(item.type === 'product') return { product: item.product, quantity: item.quantity, price: item.price };
                return { package: item.package, quantity: item.quantity, price: item.price };
            }),
            totalAmount: Number(finalAmount.toFixed(2)),
            couponApplied: couponAppliedData
        });

        const createdOrder = await order.save();

        // Stock Deduction
        for (const item of orderItems) {
            if (item.type === 'product') {
                const product = await Product.findById(item.product);
                if (product) {
                    product.stock -= item.quantity;
                    await product.save();
                }
            } else if (item.type === 'package') {
                const pkg = await Package.findById(item.package).populate('includedProducts');
                if (pkg) {
                    pkg.stock -= item.quantity;
                    await pkg.save();
                    for (const prod of pkg.includedProducts) {
                         const currentProd = await Product.findById(prod._id);
                         if (currentProd) {
                             currentProd.stock -= item.quantity;
                             await currentProd.save();
                         }
                    }
                }
            }
        }

        // Send Emails
        const emailItemsWithDetails = [];
        for (const item of orderItems) {
            if (item.type === 'product') {
                emailItemsWithDetails.push({
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price,
                    details: ''
                });
            } else if (item.type === 'package') {
                const pkg = await Package.findById(item.package).populate('includedProducts');
                const contentNames = pkg ? pkg.includedProducts.map(p => p.name).join(', ') : 'Unknown';
                emailItemsWithDetails.push({
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price,
                    details: contentNames
                });
            }
        }

        const userMailOptions = {
            from: process.env.EMAIL_USER,
            to: customerEmail,
            subject: 'Order Confirmation - N&Y Medical Equipment Store',
            html: `
                <h1>Thank you for your order!</h1>
                <p>Order ID: ${createdOrder._id}</p>
                <p><strong>Total Amount: ${finalAmount.toFixed(2)} EGP</strong></p>
                ${couponAppliedData ? `<p>(Includes discount from coupon: ${couponAppliedData.code})</p>` : ''}
                <h3>Items:</h3>
                <ul>
                    ${emailItemsWithDetails.map(item => `<li>${item.name} - ${item.quantity} x ${item.price} EGP</li>`).join('')}
                </ul>
                <p>We will notify you when your order is shipped.</p>
            `
        };

        const adminMailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER,
            subject: 'New Order Received! (Guest)',
            html: `
                <h1>New Guest Order Received!</h1>
                <h2>Order Details</h2>
                <p><strong>Order ID:</strong> ${createdOrder._id}</p>
                <p><strong>Subtotal:</strong> ${totalAmount.toFixed(2)} EGP</p>
                <p><strong>Total (After Discount):</strong> ${finalAmount.toFixed(2)} EGP</p>
                <p><strong>Coupon Used:</strong> ${couponAppliedData ? couponAppliedData.code : 'None'}</p>
                
                <h2>Customer Details</h2>
                <p><strong>Type:</strong> Guest</p>
                <p><strong>Name:</strong> ${customerName}</p>
                <p><strong>Email:</strong> ${customerEmail}</p>
                <p><strong>Phone:</strong> ${customerPhone}</p>
                <p><strong>Address:</strong> ${customerAddress}</p>

                <h2>Order Items</h2>
                <ul>
                    ${emailItemsWithDetails.map(item => {
                        let itemString = `<li><strong>${item.name}</strong> - ${item.quantity} x ${item.price} EGP`;
                        if (item.details) {
                            itemString += `<br><small>Contains: ${item.details}</small>`;
                        }
                        itemString += `</li>`;
                        return itemString;
                    }).join('')}
                </ul>
            `
        };

        try {
             if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
                await transporter.sendMail(userMailOptions);
                console.log('Order confirmation email sent to guest');
                await transporter.sendMail(adminMailOptions);
                console.log('Order notification email sent to admin');
             } else {
                 console.log('Email credentials not found, skipping emails.');
             }
        } catch (emailError) {
            console.error('Error sending email:', emailError);
        }

        res.status(201).json(createdOrder);

    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});


// @desc    Validate and retrieve item details for guest cart
// @route   POST /api/guest/add-to-cart
// @access  Public
router.post('/add-to-cart', async (req, res) => {
    const { productId, packageId, quantity } = req.body;
    const qty = parseInt(quantity) || 1;

    if (!productId && !packageId) {
        return res.status(400).json({ message: 'Must provide productId or packageId' });
    }

    try {
        if (productId) {
            const product = await Product.findById(productId);
            if (!product) {
                return res.status(404).json({ message: 'Product not found' });
            }
            
            if (qty > product.stock) {
                 return res.status(400).json({ 
                    message: `Not enough stock. Available: ${product.stock}`,
                    stock: product.stock 
                });
            }

            // Return lightweight object for frontend cart
            return res.json({
                product: {
                    _id: product._id,
                    name: product.name,
                    price: product.price,
                    images: product.images, // Assuming images field exists
                    stock: product.stock
                },
                quantity: qty,
                type: 'product'
            });

        } else if (packageId) {
            const pkg = await Package.findById(packageId);
            if (!pkg) {
                 return res.status(404).json({ message: 'Package not found' });
            }

            if (qty > pkg.stock) {
                return res.status(400).json({ 
                    message: `Not enough stock. Available: ${pkg.stock}`,
                    stock: pkg.stock
                });
            }

            return res.json({
                package: {
                    _id: pkg._id,
                    name: pkg.name,
                    price: pkg.price,
                    image: pkg.image, // Assuming image field exists
                    stock: pkg.stock
                },
                quantity: qty,
                type: 'package'
            });
        }

    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});


// @desc    Validate stock for quantity update
// @route   POST /api/guest/update-quantity
// @access  Public
router.post('/update-quantity', async (req, res) => {
    const { productId, packageId, quantity } = req.body;
    const qty = parseInt(quantity);

    if (qty < 1) {
        return res.status(400).json({ message: "Quantity can't go lower than one" });
    }

    try {
        if (productId) {
            const product = await Product.findById(productId);
            if (!product) return res.status(404).json({ message: 'Product not found' });
            
            if (qty > product.stock) {
                return res.status(400).json({ 
                    message: `Not enough stock. Available: ${product.stock}`,
                    stock: product.stock
                });
            }
            return res.json({ message: 'Quantity valid', quantity: qty });

        } else if (packageId) {
            const pkg = await Package.findById(packageId);
            if (!pkg) return res.status(404).json({ message: 'Package not found' });

            if (qty > pkg.stock) {
                return res.status(400).json({ 
                    message: `Not enough stock. Available: ${pkg.stock}`,
                    stock: pkg.stock
                });
            }
            return res.json({ message: 'Quantity valid', quantity: qty });
        } else {
             return res.status(400).json({ message: 'Must provide productId or packageId' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// @desc    Apply coupon (Guest)
// @route   POST /api/guest/apply-coupon
// @access  Public
router.post('/apply-coupon', async (req, res) => {
    const { code, items } = req.body;

    if (!code) return res.status(400).json({ message: 'Coupon code is required' });
    if (!items || !Array.isArray(items)) return res.status(400).json({ message: 'Cart items are required to validate coupon' });

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

        // Validate applicability against provided items
        let discountAmount = 0;
        let appliesToAtLeastOne = false;

        // Fetch details to calculate potential discount (securely)
        for (const item of items) {
             let price = 0;
             let itemId = null;
             let type = '';

             if (item.productId) {
                 const product = await Product.findById(item.productId);
                 if (product) {
                     price = product.price;
                     itemId = product._id.toString();
                     type = 'product';
                 }
             } else if (item.packageId) {
                 const pkg = await Package.findById(item.packageId);
                 if (pkg) {
                     price = pkg.price;
                     itemId = pkg._id.toString();
                     type = 'package';
                 }
             }

             if (itemId) {
                 let applies = false;
                 if (type === 'product') {
                     if (coupon.applicableProducts.length === 0 || 
                         coupon.applicableProducts.map(p => p.toString()).includes(itemId)) {
                         applies = true;
                     }
                 } else if (type === 'package') {
                      if (coupon.applicablePackages.length === 0 || 
                         coupon.applicablePackages.map(p => p.toString()).includes(itemId)) {
                         applies = true;
                     }
                 }

                 if (applies) {
                     appliesToAtLeastOne = true;
                     const itemTotal = price * (item.quantity || 1);
                     discountAmount += (itemTotal * coupon.discountPercentage) / 100;
                 }
             }
        }

        if (!appliesToAtLeastOne && (coupon.applicableProducts.length > 0 || coupon.applicablePackages.length > 0)) {
            return res.status(400).json({ message: 'Coupon not applicable to items in cart' });
        }

        if (coupon.maxDiscountValue !== null && discountAmount > coupon.maxDiscountValue) {
             discountAmount = coupon.maxDiscountValue;
        }

        res.json({
            message: 'Coupon applied successfully',
            coupon: {
                code: coupon.code,
                discountPercentage: coupon.discountPercentage,
                discountAmount: Number(discountAmount.toFixed(2)) // Estimated discount based on current cart
            }
        });

    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// @desc    Remove coupon (Guest - No-op for backend, frontend clears state)
// @route   POST /api/guest/remove-coupon
// @access  Public
router.post('/remove-coupon', async (req, res) => {
    res.json({ message: 'Coupon removed successfully' });
});

// @desc    Clear cart (Guest - No-op for backend, frontend clears state)
// @route   POST /api/guest/clear-cart
// @access  Public
router.post('/clear-cart', async (req, res) => {
    res.json({ message: 'Cart cleared' });
});


// @desc    View cart (Hydrate items with full details)
// @route   POST /api/guest/view-cart
// @access  Public
router.post('/view-cart', async (req, res) => {
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
        return res.status(400).json({ message: 'Items array is required' });
    }

    try {
        const fullCartItems = [];

        for (const item of items) {
             let hydratedItem = null;

             if (item.productId) {
                 const product = await Product.findById(item.productId);
                 if (product) {
                     hydratedItem = {
                         product: {
                             _id: product._id,
                             name: product.name,
                             price: product.price,
                             images: product.images,
                             stock: product.stock
                         },
                         quantity: item.quantity,
                         type: 'product',
                         totalPrice: product.price * (item.quantity || 1)
                     };
                 }
             } else if (item.packageId) {
                 const pkg = await Package.findById(item.packageId);
                 if (pkg) {
                     hydratedItem = {
                         package: {
                             _id: pkg._id,
                             name: pkg.name,
                             price: pkg.price,
                             image: pkg.image,
                             stock: pkg.stock
                         },
                         quantity: item.quantity,
                         type: 'package',
                         totalPrice: pkg.price * (item.quantity || 1)
                     };
                 }
             }

             if (hydratedItem) {
                 fullCartItems.push(hydratedItem);
             }
        }

        res.json({ cart: fullCartItems });

    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

module.exports = router;

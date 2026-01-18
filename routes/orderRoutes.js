const express = require('express');
const router = express.Router();
require('dotenv').config(); // Ensure env vars are loaded
const nodemailer = require('nodemailer');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Package = require('../models/Package');
const User = require('../models/User');
const Coupon = require('../models/Coupon');
const { protect, protectOptional } = require('../middleware/authMiddleware');
const { isAdmin } = require('../middleware/auth');

// Setup Nodemailer transporter
// NOTE: This requires valid credentials in .env to work
const transporter = nodemailer.createTransport({
    service: 'gmail', // or your preferred service
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
// @desc    Create new order
// @route   POST /api/orders
// @access  Private
// @desc    Create new order
// @route   POST /api/orders
// @access  Public (Guest) or Private (User)
router.post('/', protectOptional, async (req, res) => {
    try {
        const { guestInfo, items, couponCode } = req.body;
        let orderItems = [];
        let user = null;
        let customerEmail = '';
        let customerName = '';
        let customerPhone = '';
        let customerAddress = '';
        let usedCouponCode = null;

        if (req.user) {
            // --- AUTHENTICATED USER FLOW ---
            user = await User.findById(req.user._id).populate('cart.product').populate('cart.package');
            if (!user.cart || user.cart.length === 0) {
                return res.status(400).json({ message: 'No items in cart' });
            }

            orderItems = user.cart.map(item => {
                if (item.product) {
                    return {
                        product: item.product._id,
                        quantity: item.quantity,
                        price: item.product.price,
                        name: item.product.name,
                        type: 'product'
                    };
                } else if (item.package) {
                    return {
                        package: item.package._id,
                        quantity: item.quantity,
                        price: item.package.price,
                        name: item.package.name,
                        type: 'package'
                    };
                }
                return null;
            }).filter(Boolean);

            customerEmail = user.email;
            customerName = `${user.firstName} ${user.lastName}`;
            customerPhone = user.phone;
            customerAddress = `${user.address}, ${user.city}, ${user.governorate}`;
            usedCouponCode = user.cartCoupon;

        } else {
            // --- GUEST FLOW ---
            if (!guestInfo || !items || items.length === 0) {
                return res.status(400).json({ message: 'Guest order requires guestInfo and items' });
            }

            // Trust no one: Fetch prices from DB based on IDs sent
            for (const item of items) {
                if (item.productId) {
                    const product = await Product.findById(item.productId);
                    if (!product) return res.status(404).json({ message: `Product not found: ${item.productId}` });
                    orderItems.push({
                        product: product._id,
                        quantity: item.quantity,
                        price: product.price, // Security: Use DB price
                        name: product.name,
                        type: 'product'
                    });
                } else if (item.packageId) {
                    const pkg = await Package.findById(item.packageId);
                    if (!pkg) return res.status(404).json({ message: `Package not found: ${item.packageId}` });
                    orderItems.push({
                        package: pkg._id,
                        quantity: item.quantity,
                        price: pkg.price, // Security: Use DB price
                        name: pkg.name,
                        type: 'package'
                    });
                }
            }

            customerEmail = guestInfo.email;
            customerName = `${guestInfo.firstName} ${guestInfo.lastName}`;
            customerPhone = guestInfo.phone;
            customerAddress = `${guestInfo.address}, ${guestInfo.city}, ${guestInfo.governorate}`;
            usedCouponCode = couponCode; // From Request Body
        }

        // --- COMMON LOGIC (Stock, Total, Coupon, Save, Email) ---

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
                // Check Component Stock
                for (const prod of pkg.includedProducts) {
                    const currentProd = await Product.findById(prod._id);
                    // Assuming 1:1 ratio for package components
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
            user: user ? user._id : null, 
            guestInfo: user ? undefined : guestInfo,
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

        // Clear User Cart (Only if User)
        if (user) {
            user.orders.push(createdOrder._id);
            user.cart = [];
            user.cartCoupon = null;
            await user.save();
        }

        // Send User/Guest Email
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
            subject: 'New Order Received!',
            html: `
                <h1>New Order Received!</h1>
                <h2>Order Details</h2>
                <p><strong>Order ID:</strong> ${createdOrder._id}</p>
                <p><strong>Subtotal:</strong> ${totalAmount.toFixed(2)} EGP</p>
                <p><strong>Total (After Discount):</strong> ${finalAmount.toFixed(2)} EGP</p>
                <p><strong>Coupon Used:</strong> ${couponAppliedData ? couponAppliedData.code : 'None'}</p>
                
                <h2>Customer Details</h2>
                <p><strong>Type:</strong> ${user ? 'Registered User' : 'Guest'}</p>
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
                console.log('Order confirmation email sent to user/guest');
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

// @desc    Get logged in user orders
// @route   GET /api/orders
// @access  Private
router.get('/', protect, async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user._id })
            .populate('products.product', 'name price image')
            .sort({ createdAt: -1 });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// @desc    Get all orders (Admin only)
// @route   GET /api/orders/all
// @access  Private/Admin
router.get('/all', isAdmin, async (req, res) => {
    try {
        const orders = await Order.find()
            .populate('user', 'id firstName lastName email phone governorate city address')
            .populate('products.product', 'name price image')
            .populate('products.package', 'name price image')
            .sort({ createdAt: -1 });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// @desc    Update order status (Admin only)
// @route   PUT /api/orders/:id
// @access  Private/Admin
router.put('/:id', isAdmin, async (req, res) => {
    const { status } = req.body;

    // Strict validation: Ensure only status is being updated
    const updates = Object.keys(req.body);
    const allowedUpdates = ['status'];
    const isValidOperation = updates.every((update) => allowedUpdates.includes(update));

    if (!isValidOperation) {
        return res.status(400).json({ message: 'Only status updates are allowed' });
    }

    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (order.status === 'Cancelled' && status !== 'Cancelled') {
            return res.status(400).json({ message: 'Cannot un-cancel an order directly. Please create a new order.' });
        }

        // If cancelling, restore stock
        if (status === 'Cancelled' && order.status !== 'Cancelled') {
            for (const item of order.products) {
                if (item.product) {
                    const product = await Product.findById(item.product);
                    if (product) {
                        product.stock += item.quantity;
                        await product.save();
                    }
                } else if (item.package) {
                    const pkg = await Package.findById(item.package).populate('includedProducts');
                    if (pkg) {
                        pkg.stock += item.quantity;
                        await pkg.save();
                        
                        for (const prod of pkg.includedProducts) {
                             const currentProd = await Product.findById(prod._id);
                             if (currentProd) {
                                 currentProd.stock += item.quantity;
                                 await currentProd.save();
                             }
                        }
                    }
                }
            }
        }

        order.status = status;
        const updatedOrder = await order.save();
        res.json(updatedOrder);

    } catch (error) {
         res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

module.exports = router;

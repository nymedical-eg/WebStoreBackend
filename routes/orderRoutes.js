const express = require('express');
const router = express.Router();
require('dotenv').config(); // Ensure env vars are loaded
const nodemailer = require('nodemailer');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Coupon = require('../models/Coupon');
const { protect } = require('../middleware/authMiddleware');
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
router.post('/', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate('cart.product');

        if (!user.cart || user.cart.length === 0) {
            return res.status(400).json({ message: 'No items in cart' });
        }

        const orderItems = user.cart.map(item => ({
            product: item.product._id,
            quantity: item.quantity,
            price: item.product.price
        }));

        // Validate stock for all items before creating order
        for (const item of orderItems) {
            const product = await Product.findById(item.product);
            if (!product) {
                return res.status(404).json({ message: `Product not found: ${item.product}` });
            }
            if (product.stock < item.quantity) {
                return res.status(400).json({ message: `Not enough stock for product: ${product.name}. Available: ${product.stock}` });
            }
        }

        const totalAmount = orderItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);

        // --- COUPON LOGIC START ---
        let finalAmount = totalAmount;
        let couponAppliedData = null;

        if (user.cartCoupon) {
            const coupon = await Coupon.findOne({ code: user.cartCoupon });
            
            if (coupon && coupon.isActive) {
                 if (coupon.maxUsage !== null && coupon.usedCount >= coupon.maxUsage) {
                     // Check if usage limit exceeded
                     // User requested specific error message: "coupon has been used up"
                     return res.status(400).json({ message: 'coupon has been used up' });
                 } else {
                     let discountAmount = 0;
                     orderItems.forEach(item => {
                         if (coupon.applicableProducts.length === 0 || 
                             coupon.applicableProducts.map(p => p.toString()).includes(item.product.toString())) {
                             const itemTotal = item.price * item.quantity;
                             const itemDiscount = (itemTotal * coupon.discountPercentage) / 100;
                             discountAmount += itemDiscount;
                         }
                     });

                     // Cap discount if maxDiscountValue is set
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
        // --- COUPON LOGIC END ---

        const order = new Order({
            user: req.user._id,
            products: orderItems,
            totalAmount: Number(finalAmount.toFixed(2)),
            couponApplied: couponAppliedData
        });

        const createdOrder = await order.save();

        // Reduce stock for each product
        for (const item of orderItems) {
            const product = await Product.findById(item.product);
            if (product) {
                product.stock -= item.quantity;
                await product.save();
            }
        }

        // Keep a copy of cart items for the email before clearing
        const cartItemsForEmail = user.cart.map(item => ({
            name: item.product.name,
            quantity: item.quantity,
            price: item.product.price
        }));

        // Add order to user history and clear cart
        user.orders.push(createdOrder._id);
        user.cart = [];
        user.cartCoupon = null;
        await user.save();

        // Send User Email Confirmation
        const userMailOptions = {
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: 'Order Confirmation - N&Y Medical Equipment Store',
            html: `
                <h1>Thank you for your order!</h1>
                <p>Order ID: ${createdOrder._id}</p>
                <p>Total Amount: ${totalAmount} EGP</p>
                <h3>Items:</h3>
                <ul>
                    ${cartItemsForEmail.map(item => `<li>${item.name} - ${item.quantity} x ${item.price} EGP</li>`).join('')}
                </ul>
                <p>We will notify you when your order is shipped.</p>
            `
        };

        // Send Admin Notification Email
        const adminMailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // Send to self/admin
            subject: 'New Order!',
            html: `
                <h1>New Order Received!</h1>
                <h2>Order Details</h2>
                <p><strong>Order ID:</strong> ${createdOrder._id}</p>
                <p><strong>Total Amount:</strong> ${totalAmount} EGP</p>
                
                <h2>Customer Details</h2>
                <p><strong>User ID:</strong> ${user._id}</p>
                <p><strong>Name:</strong> ${user.firstName} ${user.lastName}</p>
                <p><strong>Email:</strong> ${user.email}</p>
                <p><strong>Phone:</strong> ${user.phone}</p>

                <h2>Order Items</h2>
                <ul>
                    ${cartItemsForEmail.map(item => `<li>${item.name} - ${item.quantity} x ${item.price} EGP</li>`).join('')}
                </ul>
            `
        };

        // Attempt to send emails
        try {
             if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
                await transporter.sendMail(userMailOptions);
                console.log('Order confirmation email sent to user');
                
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
            .populate('user', 'id firstName lastName email')
            .populate('products.product', 'name price image')
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
                const product = await Product.findById(item.product);
                if (product) {
                    product.stock += item.quantity;
                    await product.save();
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

const express = require('express');
const router = express.Router();
require('dotenv').config(); // Ensure env vars are loaded
const nodemailer = require('nodemailer');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
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

        const totalAmount = orderItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);

        const order = new Order({
            user: req.user._id,
            products: orderItems,
            totalAmount
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

        // Add order to user history and clear cart
        user.orders.push(createdOrder._id);
        user.cart = [];
        await user.save();

        // Send Email Confirmation
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: 'Order Confirmation - N&Y Medical Equipment Store',
            html: `
                <h1>Thank you for your order!</h1>
                <p>Order ID: ${createdOrder._id}</p>
                <p>Total Amount: $${totalAmount}</p>
                <h3>Items:</h3>
                <ul>
                    ${user.cart.map(item => `<li>${item.product.name} - ${item.quantity} x $${item.product.price}</li>`).join('')}
                </ul>
                <p>We will notify you when your order is shipped.</p>
            `
        };

        // Attempt to send email, but don't fail the request if it fails (just log it)
        try {
             if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
                await transporter.sendMail(mailOptions);
                console.log('Order confirmation email sent');
             } else {
                 console.log('Email credentials not found, skipping email.');
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
        const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
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
        const orders = await Order.find().populate('user', 'id firstName lastName email').sort({ createdAt: -1 });
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

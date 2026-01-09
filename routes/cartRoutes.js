const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Product = require('../models/Product');
const { protect } = require('../middleware/authMiddleware');

// @desc    Get user cart
// @route   GET /api/cart
// @access  Private
router.get('/', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate('cart.product');
        
        // Calculate total
        const total = user.cart.reduce((acc, item) => {
            return acc + (item.product ? item.product.price * item.quantity : 0);
        }, 0);

        res.json({ 
            cart: user.cart, 
            total: Number(total.toFixed(2)) 
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
            const newQuantity = currentQuantity + changeAmount;

            // Check if quantity goes below 1
            if (newQuantity < 1) {
                return res.status(400).json({ message: "Quantity can't go lower than one" });
            }

            // Check if quantity exceeds stock
            if (newQuantity > product.stock) {
                 return res.status(400).json({ message: "Quantity can't go above available stock" });
            }

            // Update quantity
            user.cart[cartItemIndex].quantity = newQuantity;

            await user.save();
            const updatedUser = await User.findById(req.user._id).populate('cart.product');
            res.json(updatedUser.cart);
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

module.exports = router;

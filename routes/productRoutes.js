const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { isAdmin } = require('../middleware/auth');

// GET /api/products - Get all products (Public)
router.get('/', async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST /api/products - Add new product (Admin only)
router.post('/', isAdmin, async (req, res) => {
    const { name, description, image, stock, price } = req.body;

    const product = new Product({
        name,
        description,
        image,
        stock,
        price
    });

    try {
        const newProduct = await product.save();
        res.status(201).json(newProduct);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// PUT /api/products/:id - Edit product (Admin only)
router.put('/:id', isAdmin, async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ message: 'Product not found' });

        if (req.body.name != null) product.name = req.body.name;
        if (req.body.description != null) product.description = req.body.description;
        if (req.body.image != null) product.image = req.body.image;
        if (req.body.stock != null) product.stock = req.body.stock;
        if (req.body.price != null) product.price = req.body.price;

        const updatedProduct = await product.save();
        res.json(updatedProduct);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// DELETE /api/products/:id - Delete product (Admin only)
router.delete('/:id', isAdmin, async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ message: 'Product not found' });

        await product.deleteOne();
        res.json({ message: 'Product deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;

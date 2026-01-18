const express = require('express');
const router = express.Router();
const Package = require('../models/Package');
const { isAdmin } = require('../middleware/auth');

// @desc    Get all packages
// @route   GET /api/packages
// @access  Public
router.get('/', async (req, res) => {
    try {
        const packages = await Package.find().populate('includedProducts', 'name price image');
        res.json(packages);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc    Get single package
// @route   GET /api/packages/:id
// @access  Public
router.get('/:id', async (req, res) => {
    try {
        const pkg = await Package.findById(req.params.id).populate('includedProducts', 'name price image');
        if (!pkg) return res.status(404).json({ message: 'Package not found' });
        res.json(pkg);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc    Create a package
// @route   POST /api/packages
// @access  Admin
router.post('/', isAdmin, async (req, res) => {
    const { name, description, image, price, stock, includedProducts } = req.body;

    const pkg = new Package({
        name,
        description,
        image,
        price,
        stock,
        includedProducts
    });

    try {
        const newPackage = await pkg.save();
        res.status(201).json(newPackage);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// @desc    Update a package
// @route   PUT /api/packages/:id
// @access  Admin
router.put('/:id', isAdmin, async (req, res) => {
    try {
        const pkg = await Package.findById(req.params.id);
        if (!pkg) return res.status(404).json({ message: 'Package not found' });

        if (req.body.name != null) pkg.name = req.body.name;
        if (req.body.description != null) pkg.description = req.body.description;
        if (req.body.image != null) pkg.image = req.body.image;
        if (req.body.price != null) pkg.price = req.body.price;
        if (req.body.stock != null) pkg.stock = req.body.stock;
        if (req.body.includedProducts != null) pkg.includedProducts = req.body.includedProducts;

        const updatedPackage = await pkg.save();
        res.json(updatedPackage);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// @desc    Delete a package
// @route   DELETE /api/packages/:id
// @access  Admin
router.delete('/:id', isAdmin, async (req, res) => {
    try {
        const pkg = await Package.findById(req.params.id);
        if (!pkg) return res.status(404).json({ message: 'Package not found' });

        await pkg.deleteOne();
        res.json({ message: 'Package deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;

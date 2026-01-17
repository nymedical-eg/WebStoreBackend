const express = require('express');
const router = express.Router();
const Coupon = require('../models/Coupon');
const { checkAdminRoleHeader } = require('../middleware/authMiddleware');

// @route   POST /api/coupons
// @desc    Create a new coupon
// @access  Admin only (Header x-role: admin)
router.post('/', checkAdminRoleHeader, async (req, res) => {
    try {
        const { code, discountPercentage, maxUsage, maxDiscountValue, applicableProducts, isActive } = req.body;

        // Check if coupon already exists
        const existingCoupon = await Coupon.findOne({ code });
        if (existingCoupon) {
            return res.status(400).json({ message: 'Coupon with this code already exists' });
        }

        const coupon = new Coupon({
            code,
            discountPercentage,
            maxUsage,
            maxDiscountValue,
            applicableProducts,
            isActive
        });

        await coupon.save();
        res.status(201).json(coupon);
    } catch (err) {
        console.error('Error creating coupon:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/coupons
// @desc    Get all coupons
// @access  Admin only (Header x-role: admin)
router.get('/', checkAdminRoleHeader, async (req, res) => {
    try {
        const coupons = await Coupon.find().sort({ createdAt: -1 });
        res.json(coupons);
    } catch (err) {
        console.error('Error fetching coupons:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/coupons/:id
// @desc    Update a coupon
// @access  Admin only (Header x-role: admin)
router.put('/:id', checkAdminRoleHeader, async (req, res) => {
    try {
        const { code, discountPercentage, maxUsage, maxDiscountValue, applicableProducts, isActive } = req.body;

        const coupon = await Coupon.findById(req.params.id);
        if (!coupon) {
            return res.status(404).json({ message: 'Coupon not found' });
        }

        // Update fields
        if (code) coupon.code = code;
        if (discountPercentage !== undefined) coupon.discountPercentage = discountPercentage;
        if (maxUsage !== undefined) coupon.maxUsage = maxUsage;
        if (maxDiscountValue !== undefined) coupon.maxDiscountValue = maxDiscountValue;
        if (applicableProducts) coupon.applicableProducts = applicableProducts;
        if (isActive !== undefined) coupon.isActive = isActive;

        await coupon.save();
        res.json(coupon);
    } catch (err) {
        console.error('Error updating coupon:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   DELETE /api/coupons/:id
// @desc    Delete a coupon
// @access  Admin only (Header x-role: admin)
router.delete('/:id', checkAdminRoleHeader, async (req, res) => {
    try {
        const coupon = await Coupon.findByIdAndDelete(req.params.id);
        if (!coupon) {
            return res.status(404).json({ message: 'Coupon not found' });
        }
        res.json({ message: 'Coupon deleted successfully' });
    } catch (err) {
        console.error('Error deleting coupon:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;

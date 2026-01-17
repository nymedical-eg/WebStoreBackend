const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    discountPercentage: {
        type: Number,
        required: true,
        min: [0, 'Discount percentage cannot be less than 0'],
        max: [100, 'Discount percentage cannot be more than 100']
    },
    maxUsage: {
        type: Number,
        default: null
    },
    maxDiscountValue: {
        type: Number,
        default: null
    },
    usedCount: {
        type: Number,
        default: 0
    },
    applicableProducts: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product'
        }
    ],
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Coupon', couponSchema);

const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    products: [
        {
            product: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Product'
            },
            package: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Package'
            },
            quantity: {
                type: Number,
                required: true
            },
            price: {
                type: Number,
                required: true
            }
        }
    ],
    totalAmount: {
        type: Number,
        required: true
    },
    couponApplied: {
        code: String,
        discountAmount: Number
    },
    status: {
        type: String,
        default: 'Pending',
        enum: ['Pending', 'Shipped', 'Confirmed', 'Cancelled', 'Completed']
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Order', orderSchema);

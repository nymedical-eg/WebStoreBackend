const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    image: {
        type: String,
        required: true
    },
    stock: {
        type: Number,
        required: true,
        default: 0,
        min: [0, 'Stock cannot be less than 0'],
        validate: {
            validator: Number.isInteger,
            message: 'Stock must be an integer'
        }
    },
    price: {
        type: Number,
        required: true,
        default: 0,
        min: [0, 'Price cannot be less than 0']
    }
});

module.exports = mongoose.model('Product', productSchema);

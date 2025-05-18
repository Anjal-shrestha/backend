// models/PendingTransaction.js
const mongoose = require("mongoose");

const pendingTransactionSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  eventId: { type: String, required: true },
  quantity: { type: Number, required: true },
  amount: { type: Number, required: true },
  pid: { type: String, required: true, unique: true },
  status: { type: String, default: "pending" },
  ticketType: {
    type: String,
    required: true,
    enum: ['General', 'FanFest', 'VIP']
  }
}, { timestamps: true });

const PendingTransaction = mongoose.model("PendingTransaction", pendingTransactionSchema);
module.exports = PendingTransaction;
const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema({
  userid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  eventid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Event",
    required: true
  },
  purchaseId: {
    type: String,
    required: true 
  },
  ticketDetails: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    eventname: { type: String, required: true },
    eventdate: { type: Date, required: true },
    eventtime: { type: String, required: true },
    location: { type: String }, 
    image: { type: String }, 
    ticketprice: { type: Number, required: true },
    ticketType: { 
      type: String,
      enum: ['General', 'FanFest', 'VIP'],
      required: true
    },
    qr: { type: String, required: true }
  },
  count: { type: Number, default: 1 }
});

const TicketModel = mongoose.model("Ticket", ticketSchema);
module.exports = TicketModel;
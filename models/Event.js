const mongoose = require("mongoose");
const { Schema } = mongoose;

const eventSchema = new Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: { type: String, required: true },
  description: { type: String, required: true },
  organizedBy: { type: String, required: true },
  eventDate: { type: Date, required: true },
  eventTime: { type: String, required: true },
  location: { type: String, required: true },
  ticketPrice: { type: Number, required: true },
  Quantity: { type: Number, required: true },
  ticketsSold: { type: Number, default: 0 },
  image: { type: String, required: true },
  likes: { type: Number, default: 0 },
  comments: [{
    text: { type: String, required: true },
    user: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User',
      required: true 
    },
    createdAt: { type: Date, default: Date.now }
  }],
  approved: { type: Boolean, default: false },
});

const Event = mongoose.model("Event", eventSchema);

module.exports = Event;
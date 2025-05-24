// migrateEvents.js

require("dotenv").config(); // Load environment variables from .env
const mongoose = require("mongoose");
const Event = require("./models/Event"); // Adjust path if needed

async function migrateEvents() {
  try {
    const mongoUrl = process.env.MONGO_URL;

    // 🔍 Check if MONGO_URL is defined and valid
    if (!mongoUrl) {
      throw new Error("MONGO_URL is missing in environment variables.");
    }

    // ✅ Ensure the URL starts with mongodb:// or mongodb+srv://
    if (!mongoUrl.startsWith("mongodb://") && !mongoUrl.startsWith("mongodb+srv://")) {
      throw new Error("Invalid MongoDB connection string. Must start with 'mongodb://' or 'mongodb+srv://'");
    }

    // 🚀 Connect to DB
    await mongoose.connect(mongoUrl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("✅ Connected to MongoDB");

    // 📦 Fetch all events
    const events = await Event.find({});

    for (let event of events) {
      if (event.approved === true) {
        event.status = "approved";
      } else {
        event.status = "pending"; // You can change to "rejected" based on logic
      }

      await event.save();
      console.log(`📝 Updated event ${event._id} -> status: ${event.status}`);
    }

    console.log("🎉 Migration complete for all events.");
    mongoose.connection.close();
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    mongoose.connection.close();
    process.exit(1);
  }
}

migrateEvents();
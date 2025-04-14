const express = require("express");
const cors = require("cors");
require("dotenv").config();
const mongoose = require("mongoose");
const UserModel = require("./models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");

const Ticket = require("./models/Ticket");
const Event = require("./models/Event");

const app = express();

// Constants
const bcryptSalt = bcrypt.genSaltSync(10);
const jwtSecret = process.env.JWT_SECRET || "default_secret";

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(cors({ credentials: true, origin: "http://localhost:3000" }));

// Ensure the 'uploads' directory exists
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Serve static files from the 'uploads' directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Multer Configuration for File Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Unique filename
  },
});

const upload = multer({ storage });

// Middleware to Authenticate User
const authenticateUser = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  jwt.verify(token, jwtSecret, (err, userData) => {
    if (err) return res.status(401).json({ error: "Unauthorized" });
    req.user = userData;
    next();
  });
};

// Middleware to Check Admin Role
const isAdmin = (req, res, next) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
};

// Automatically Create Admin Account if Not Exists
const createAdminIfNotExists = async () => {
  try {
    const adminExists = await UserModel.findOne({ email: "admin@mail.com" });
    if (!adminExists) {
      await UserModel.create({
        name: "Admin",
        email: "admin@mail.com",
        password: bcrypt.hashSync("admin", bcryptSalt),
        role: "admin",
      });
      console.log("Admin account created.");
    }
  } catch (error) {
    console.error("Error creating admin account:", error);
  }
};

createAdminIfNotExists();

// Routes

// Test Route
app.get("/test", (req, res) => {
  res.json("test ok");
});

// Register User
// ✅ Fix: Don't hash it here, let the schema hook handle it
app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const userDoc = await UserModel.create({
      name,
      email,
      password, // plain text password
      role: "user",
    });
    res.json(userDoc);
  } catch (e) {
    res.status(422).json(e);
  }
});


// Login User
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const userDoc = await UserModel.findOne({ email });

    if (!userDoc) {
      return res.status(404).json({ error: "User not found" });
    }

    const passOk = bcrypt.compareSync(password, userDoc.password);
    if (!passOk) {
      return res.status(401).json({ error: "Invalid password" });
    }

    jwt.sign(
      { email: userDoc.email, id: userDoc._id, role: userDoc.role },
      jwtSecret,
      {},
      (err, token) => {
        if (err) {
          return res.status(500).json({ error: "Failed to generate token" });
        }
        res.cookie("token", token).json({ ...userDoc.toObject(), token, role: userDoc.role });
      }
    );
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get Profile
app.get("/profile", authenticateUser, async (req, res) => {
  try {
    const { name, email, _id, role } = await UserModel.findById(req.user.id);
    res.json({ name, email, _id, role });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Logout
app.post("/logout", (req, res) => {
  res.cookie("token", "").json(true);
});

// Event Management Routes

// Create Event (Admin Only)
app.post("/createEvent", upload.single("image"), authenticateUser, isAdmin, async (req, res) => {
  try {
    const eventData = req.body;
    eventData.image = req.file ? `uploads/${req.file.filename}` : ""; // Relative path
    eventData.owner = req.user.id; // Set the owner to the current admin
    eventData.approved = true; // Admins can approve events
    const newEvent = new Event(eventData);
    await newEvent.save();
    res.status(201).json(newEvent);
  } catch (error) {
    console.error("Error creating event:", error);
    res.status(500).json({ error: "Failed to save the event to MongoDB" });
  }
});

// Get All Events
app.get("/events", async (req, res) => {
  try {
    const events = await Event.find();
    res.status(200).json(events);
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: "Failed to fetch events from MongoDB" });
  }
});

// Get Event by ID
app.get("/event/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const event = await Event.findById(id);
    res.json(event);
  } catch (error) {
    console.error("Error fetching event:", error);
    res.status(500).json({ error: "Failed to fetch event from MongoDB" });
  }
});

// Like Event (User Only)
app.post("/event/:eventId/like", authenticateUser, async (req, res) => {
  const eventId = req.params.eventId;

  try {
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    event.likes += 1;
    await event.save();
    res.json(event);
  } catch (error) {
    console.error("Error liking the event:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update Event (Admin Only)
app.put("/event/:eventId", upload.single("image"), authenticateUser, isAdmin, async (req, res) => {
  const eventId = req.params.eventId;
  const eventData = req.body;

  // Update the image path if a new image is uploaded
  eventData.image = req.file ? `uploads/${req.file.filename}` : eventData.image;

  try {
    const updatedEvent = await Event.findByIdAndUpdate(eventId, eventData, { new: true });
    if (!updatedEvent) {
      return res.status(404).json({ message: "Event not found" });
    }
    res.json(updatedEvent);
  } catch (error) {
    console.error("Error updating the event:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete Event (Admin Only)
app.delete("/event/:eventId", authenticateUser, isAdmin, async (req, res) => {
  const eventId = req.params.eventId;

  try {
    const deletedEvent = await Event.findByIdAndDelete(eventId);
    if (!deletedEvent) {
      return res.status(404).json({ message: "Event not found" });
    }
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting the event:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Book a Ticket (User Only)
app.post("/bookTicket/:eventId", authenticateUser, async (req, res) => {
  const { eventId } = req.params;
  const userId = req.user.id;

  try {
    // Find the event by ID
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Check if tickets are still available
    if (event.Quantity <= 0) {
      return res.status(400).json({ error: "No tickets available for this event" });
    }

    // Deduct one ticket from the event
    event.Quantity -= 1;
    await event.save();

    // Generate a unique QR code for the ticket
    const qrData = JSON.stringify({
      userId,
      eventId,
      bookingDate: new Date(),
    });

    const qrCode = await QRCode.toDataURL(qrData); // Generate QR code as a data URL

    // Create a new ticket record
    const newTicket = new Ticket({
      userid: userId,
      eventid: eventId,
      ticketDetails: {
        name: req.body.name,
        email: req.body.email,
        eventname: event.title,
        eventdate: event.eventDate,
        eventtime: event.eventTime,
        ticketprice: event.ticketPrice,
        qr: qrCode,
      },
      count: 1,
    });

    await newTicket.save();

    res.status(201).json({ message: "Ticket booked successfully", ticket: newTicket });
  } catch (error) {
    console.error("Error booking ticket:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get Tickets by User ID (User Only)
app.get("/tickets/user/:userId", authenticateUser, async (req, res) => {
  try {
    const tickets = await Ticket.find({ userid: req.params.userId });
    res.json(tickets);
  } catch (error) {
    console.error("Error fetching user tickets:", error);
    res.status(500).json({ error: "Failed to fetch user tickets" });
  }
});

// Start the Server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
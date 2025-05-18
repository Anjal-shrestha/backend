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
const session = require('express-session');
const Ticket = require("./models/Ticket");
const Event = require("./models/Event");
const Notification = require("./models/Notification");
const app = express();
const PendingTransaction = require("./models/PendingTransaction");
const processedTransactions = new Map();
// Constants
const bcryptSalt = bcrypt.genSaltSync(10);
const jwtSecret = process.env.JWT_SECRET || "default_secret";
const nodemailer = require('nodemailer');
const otpGenerator = require('otp-generator');
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});
// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(cors({ credentials: true, origin: "http://localhost:3000" }));

// Ensure the 'uploads' directory <exists></exists>
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
app.use(session({
  secret: 'your_session_secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));
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

// Middleware to Check Organizer or Admin Role
const isOrganizerOrAdmin = (req, res, next) => {
  if (req.user.role !== "admin" && req.user.role !== "organizer") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
};
const canModifyEvent = async (req, res, next) => {
  const { role, id } = req.user; // from JWT
  const eventId = req.params.eventId;

  try {
    const event = await Event.findById(eventId);

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Admins can modify any event
    if (role === "admin") {
      return next();
    }

    // Organizers can only modify their own events
    if (role === "organizer" && event.owner.toString() === id) {
      return next();
    }

    return res.status(403).json({ error: "You do not have permission to modify this event" });
  } catch (error) {
    console.error("Error checking event ownership:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

// Automatically Create Admin Account if Not Exists
const createAdminIfNotExists = async () => {
  try {
    const adminExists = await UserModel.findOne({ email: "admin@mail.com" });
    if (!adminExists) {
      await UserModel.create({
        name: "Admin",
        email: "admin@mail.com",
        password: "admin", // Plain text; will be hashed by pre-save hook
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
// Store OTPs temporarily (add this near your other constants)
const otpStorage = {};

// Send OTP endpoint
app.post('/send-otp', async (req, res) => {
  const { email } = req.body;
  
  // Validate email format
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address' });
  }

  // Generate OTP
  const otp = otpGenerator.generate(6, {
    digits: true,
    alphabets: false,
    upperCase: false,
    specialChars: false
  });
  
  // Store OTP with expiration (10 minutes)
  otpStorage[email] = {
    otp,
    expiresAt: Date.now() + 600000
  };
  
  // Send email
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Your OTP for Email Verification',
    text: `Your OTP is: ${otp}\nThis OTP will expire in 10 minutes.`
  };
  
  try {
    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// Verify OTP endpoint
app.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  
  // Check if OTP exists and isn't expired
  if (!otpStorage[email] || otpStorage[email].expiresAt < Date.now()) {
    return res.status(400).json({ error: 'OTP expired or invalid' });
  }
  
  if (otpStorage[email].otp === otp) {
    delete otpStorage[email]; // OTP used, remove it
    res.status(200).json({ message: 'Email verified successfully' });
  } else {
    res.status(400).json({ error: 'Invalid OTP' });
  }
});
// Register User
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
    const user = await UserModel.findById(req.user.id).populate('savedEvents');
    const tickets = await Ticket.find({ userid: req.user.id }).sort({ createdAt: -1 });

    res.json({
      name: user.name,
      email: user.email,
      _id: user._id,
      role: user.role,
      tickets,
      savedEvents: user.savedEvents || []
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Logout
app.post("/logout", (req, res) => {
  res.cookie("token", "").json(true);
});
// Initiate eSewa Payment
// POST /initiate-esewa-payment
app.post("/initiate-esewa-payment", authenticateUser, async (req, res) => {
  let { eventId, quantity, ticketType } = req.body;
  
  // Fallback if ticketType missing
  if (!ticketType) {
    ticketType = "General";
  }

  // Validate ticket type
  if (!['General', 'FanFest', 'VIP'].includes(ticketType)) {
    return res.status(400).json({ error: `Invalid ticket type: ${ticketType}` });
  }

  const userId = req.user.id;

  // Validate input
  if (!eventId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: "Missing or invalid required fields" });
  }

  try {
    // Step 1: Find event
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Step 2: Find selected ticket type
    const selectedTicketType = event.ticketTypes.find(t => t.name === ticketType);

    if (!selectedTicketType || selectedTicketType.quantity < quantity) {
      return res.status(400).json({ error: "Selected ticket type not available in requested quantity" });
    }

    const totalPrice = selectedTicketType.price * parseInt(quantity);

    // Step 3: Generate unique transaction ID
    const pid = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Step 4: Save transaction
    const transaction = new PendingTransaction({
      userId,
      eventId,
      quantity,
      amount: totalPrice,
      pid,
      status: "pending",
      ticketType
    });

    await transaction.save();

    // Step 5: Prepare form data for eSewa
    const formData = {
      amt: totalPrice.toFixed(2),
      psc: 0,
      pdc: 0,
      txAmt: 0,
      tAmt: totalPrice.toFixed(2),
      pid: pid,
      scd: process.env.ESEWA_MERCHANT_CODE,
      su: `${process.env.PAYMENT_SUCCESS_URL}?oid=${pid}`,
      fu: `${process.env.PAYMENT_FAILURE_URL}?oid=${pid}`
    };

    // Step 6: Return redirect URL + form data
    const esewaUrl = process.env.ESEWA_BASE_URL;
    res.json({ redirectUrl: esewaUrl, formData });

  } catch (error) {
    console.error("Error initiating eSewa payment:", error.message);
    res.status(500).json({ error: "Failed to initiate eSewa payment" });
  }
});


// Confirm eSewa Payment and Book Ticket

app.post("/confirm-esewa-payment", authenticateUser, async (req, res) => {
  const { refId, oid } = req.body;
  const userId = req.user.id;

  if (!oid || !refId) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    // Step 1: Find pending transaction
    const pendingTxn = await PendingTransaction.findOne({ pid: oid });

    if (!pendingTxn || pendingTxn.userId.toString() !== userId) {
      return res.status(400).json({ error: "Invalid or unauthorized transaction" });
    }

    // Step 2: Check if tickets already exist
    const existingTickets = await Ticket.find({ purchaseId: oid });
    if (existingTickets.length > 0) {
      return res.json({
        tickets: existingTickets,
        eventId: pendingTxn.eventId,
        quantity: existingTickets.length
      });
    }

    // Step 3: Fetch event & user
    const event = await Event.findById(pendingTxn.eventId);
    const user = await UserModel.findById(userId);

    if (!event || !user) {
      return res.status(404).json({ error: "Event or user not found" });
    }

    // Step 4: Validate ticket type
    if (!['General', 'FanFest', 'VIP'].includes(pendingTxn.ticketType)) {
      return res.status(400).json({ error: "Invalid ticket type in transaction" });
    }

    const selectedTicketType = event.ticketTypes.find(t => t.name === pendingTxn.ticketType);
    if (!selectedTicketType || selectedTicketType.quantity < pendingTxn.quantity) {
      return res.status(400).json({ error: "Not enough tickets available" });
    }

    // Step 5: Update event inventory atomically
    const updatedEvent = await Event.findOneAndUpdate(
      { _id: pendingTxn.eventId, "ticketTypes.name": pendingTxn.ticketType },
      {
        $inc: {
          "ticketTypes.$.quantity": -pendingTxn.quantity,
          "ticketTypes.$.sold": +pendingTxn.quantity
        }
      },
      { new: true }
    );

    if (!updatedEvent) {
      throw new Error("Failed to update event inventory");
    }

    // Step 6: Generate tickets with QR codes
    const ticketPromises = [];
    for (let i = 0; i < pendingTxn.quantity; i++) {
      const qrData = JSON.stringify({
        userId,
        eventId: pendingTxn.eventId,
        purchaseId: oid,
        timestamp: new Date(),
      });

      let qrCode;
      try {
        qrCode = await QRCode.toDataURL(qrData);
      } catch (err) {
        throw new Error("Failed to generate QR code");
      }

      const ticket = new Ticket({
        userid: userId,
        eventid: pendingTxn.eventId,
        purchaseId: oid,
        ticketDetails: {
          name: user.name,
          email: user.email,
          eventname: event.title,
          eventdate: event.eventDate,
          eventtime: event.eventTime,
          location: event.location,
          image: event.image,
          ticketprice: selectedTicketType.price,
          ticketType: selectedTicketType.name,
          qr: qrCode
        },
        count: 1
      });

      ticketPromises.push(ticket.save());
    }

    const savedTickets = await Promise.all(ticketPromises);

    // Step 7: Clean up
    await PendingTransaction.deleteOne({ pid: oid });

    res.json({
      tickets: savedTickets,
      eventId: pendingTxn.eventId,
      quantity: savedTickets.length
    });

  } catch (error) {
    console.error("Error confirming payment:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/check-payment-status/:purchaseId", authenticateUser, async (req, res) => {
  try {
    const purchaseId = req.params.purchaseId;
    const userId = req.user.id;

    // Check if we have tickets for this purchase
    const tickets = await Ticket.find({ 
      userid: userId,
      purchaseId 
    });

    if (tickets.length === 0) {
      return res.status(404).json({ error: "No tickets found for this purchase" });
    }

    // Return information without triggering another ticket creation
    res.json({
      success: true,
      tickets: tickets, // Return all tickets as an array
      eventId: tickets[0].eventid,
      quantity: tickets.length
    });
  } catch (error) {
    console.error("Error checking payment status:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/user/tickets/latest", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { oid } = req.query;

    let query = { userid: userId };
    if (oid) {
      query.purchaseId = oid;
    }

    // Get all tickets for this purchase or latest ones
    const tickets = await Ticket.find(query)
      .sort({ createdAt: -1 })
      .limit(oid ? 100 : 10);

    if (!tickets.length) {
      return res.status(404).json({ error: "No tickets found" });
    }

    res.json({ tickets });

  } catch (error) {
    console.error("Error fetching latest tickets:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});
// Book a Ticket (User Only)
app.post("/bookTicket/:eventId", authenticateUser, async (req, res) => {
  const { eventId } = req.params;
  const userId = req.user.id;
  const { name, email, ticketType = "General" } = req.body;

  // Validate inputs
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  if (!['General', 'FanFest', 'VIP'].includes(ticketType)) {
    return res.status(400).json({ error: `Invalid ticket type: ${ticketType}` });
  }

  try {
    // Step 1: Find event
    const event = await Event.findById(eventId);

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Step 2: Find selected ticket type
    const selectedTicketType = event.ticketTypes.find(t => t.name === ticketType);

    if (!selectedTicketType || selectedTicketType.quantity <= 0) {
      return res.status(400).json({ error: "Selected ticket type not available" });
    }

    // Step 3: Update event inventory atomically
    const updatedEvent = await Event.findOneAndUpdate(
      { _id: eventId, "ticketTypes.name": ticketType },
      {
        $inc: {
          "ticketTypes.$.quantity": -1,
          "ticketTypes.$.sold": 1
        }
      },
      { new: true }
    );

    if (!updatedEvent) {
      return res.status(400).json({ error: "Failed to book ticket" });
    }

    // Step 4: Generate QR Code
    const purchaseId = `TICKET-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const qrData = JSON.stringify({
      userId,
      eventId,
      purchaseId,
      timestamp: new Date(),
    });

    let qrCode;
    try {
      qrCode = await QRCode.toDataURL(qrData);
    } catch (err) {
      console.error("QR generation failed:", err.message);
      return res.status(500).json({ error: "Failed to generate QR code" });
    }

    // Step 5: Save ticket
    const ticket = new TicketModel({
      userid: userId,
      eventid: eventId,
      purchaseId,
      ticketDetails: {
        name,
        email,
        eventname: event.title,
        eventdate: event.eventDate,
        eventtime: event.eventTime,
        location: event.location,
        image: event.image,
        ticketprice: selectedTicketType.price,
        ticketType: selectedTicketType.name,
        qr: qrCode
      },
      count: 1
    });

    await ticket.save();

    // Step 6: Return full ticket data
    res.json({
      ticket,
      message: "Ticket booked successfully"
    });

  } catch (error) {
    console.error("Error booking ticket:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});


// Get comments for an event
app.get('/event/:eventId/comments', async (req, res) => {
  const { eventId } = req.params;

  try {
    const event = await Event.findById(eventId).populate({
      path: 'comments.user',
      select: 'name email' // Only select name and email
    });
    
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Map through comments to ensure consistent structure
    const formattedComments = event.comments.map(comment => ({
      _id: comment._id,
      text: comment.text,
      createdAt: comment.createdAt,
      user: {
        _id: comment.user._id,
        name: comment.user.name,
        email: comment.user.email
      }
    }));

    res.status(200).json(formattedComments);
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});
// Create Organizer (Admin Only)
// Create Organizer (Admin Only)
app.post("/createOrganizer", authenticateUser, isAdmin, async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User with this email already exists" });
    }
    const organizer = await UserModel.create({
      name,
      email,
      password, // Plain text; will be hashed by pre-save hook
      role: "organizer",
    });
    res.status(201).json({ message: "Organizer created successfully", organizer });
  } catch (error) {
    console.error("Error creating organizer:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get All Organizers (Admin Only)
app.get("/organizers", authenticateUser, isAdmin, async (req, res) => {
  try {
    const organizers = await UserModel.find({ role: "organizer" });
    res.status(200).json(organizers);
  } catch (error) {
    console.error("Error fetching organizers:", error);
    res.status(500).json({ error: "Failed to fetch organizers" });
  }
});
app.get("/organizer/events", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    // Step 1: Get all events owned by user
    const events = await Event.find({ owner: userId }).sort({ createdAt: -1 });

    // Step 2: Get all tickets for those events
    const eventIds = events.map(event => event._id);
    const tickets = await Ticket.find({ eventid: { $in: eventIds } });

    // Step 3: Group tickets by event
    const ticketStats = {};

    tickets.forEach(ticket => {
      const eventId = ticket.eventid;
      const ticketType = ticket.ticketDetails?.ticketType || "General";
      const quantity = parseInt(ticket.count || 1);
      const event = events.find(e => e._id.toString() === eventId);

      if (!event) return;

      if (!ticketStats[eventId]) {
        ticketStats[eventId] = {
          General: 0,
          FanFest: 0,
          VIP: 0,
          earnings: 0
        };
      }

      const basePrice = event.ticketTypes.find(t => t.name === ticketType)?.price || 0;

      // Apply phase discount
      const purchaseDate = new Date(ticket.createdAt);
      const activePhase = event.salePhases?.find(phase => {
        const start = new Date(phase.startDate);
        const end = new Date(phase.endDate);
        return purchaseDate >= start && purchaseDate <= end;
      });

      const finalPrice = activePhase && activePhase.discountPercent > 0
        ? Math.round(basePrice * (1 - activePhase.discountPercent / 100))
        : basePrice;

      // Increment count based on ticket type
      if (['General', 'FanFest', 'VIP'].includes(ticketType)) {
        ticketStats[eventId][ticketType] += quantity;
        ticketStats[eventId].earnings += finalPrice * quantity;
      }
    });

    // Step 4: Attach stats to each event
    const enrichedEvents = events.map(event => ({
      ...event.toObject(),
      breakdown: ticketStats[event._id.toString()] || {
        General: 0,
        FanFest: 0,
        VIP: 0,
        earnings: 0
      }
    }));

    res.status(200).json(enrichedEvents);

  } catch (error) {
    console.error("Error fetching organizer events:", error.message);
    res.status(500).json({ error: "Failed to load events" });
  }
});
// Delete Organizer (Admin Only)
app.delete("/organizer/:id", authenticateUser, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const deletedOrganizer = await UserModel.findByIdAndDelete(id);
    if (!deletedOrganizer) {
      return res.status(404).json({ error: "Organizer not found" });
    }
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting organizer:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Create Event (Admin or Organizer)
app.post(
  "/createEvent",
  upload.single("image"),
  authenticateUser,
  isOrganizerOrAdmin,
  async (req, res) => {
    const { id, role, name } = req.user;

    let eventData = { ...req.body };
 if (eventData.salePhases && typeof eventData.salePhases === "string") {
      try {
        eventData.salePhases = JSON.parse(eventData.salePhases);
      } catch (err) {
        return res.status(400).json({ error: "Invalid salePhases format" });
      }
    }
    try {
      // 🔁 Restore this part — fetch full organizer
      const organizer = await UserModel.findById(id);
      if (!organizer) {
        return res.status(404).json({ error: "Organizer not found" });
      }

      // Validate user ID
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid user ID" });
      }

      // Parse ticketTypes if provided
      if (eventData.ticketTypes && typeof eventData.ticketTypes === "string") {
        try {
          eventData.ticketTypes = JSON.parse(eventData.ticketTypes);
        } catch (err) {
          return res.status(400).json({ error: "Invalid ticketTypes format" });
        }
      }

      // Validate each ticket type
      if (Array.isArray(eventData.ticketTypes)) {
        eventData.ticketTypes.forEach((type) => {
          if (!['General', 'FanFest', 'VIP'].includes(type.name)) {
            throw new Error(`Invalid ticket type: ${type.name}`);
          }
          const price = parseFloat(type.price);
          const quantity = parseInt(type.quantity);

          if (isNaN(price) || price <= 0) {
            throw new Error(`Invalid price for ${type.name}`);
          }
          if (isNaN(quantity) || quantity < 0) {
            throw new Error(`Invalid quantity for ${type.name}`);
          }

          type.price = price;
          type.quantity = quantity;
        });
      }

      // Handle image upload
      if (req.file) {
        eventData.image = `uploads/${req.file.filename}`;
      }

      // ✅ Use organizer.name instead of req.user.name
      eventData.owner = id;
      eventData.organizedBy = organizer.name; // ✅ This is what was missing
      eventData.approved = role === "admin";

      // Create and save event
      const newEvent = new Event(eventData);
      await newEvent.save();

      // Notify admins
      const admins = await UserModel.find({ role: "admin" });
      for (const admin of admins) {
        await Notification.create({
          userId: admin._id,
          message: `New event "${newEvent.title}" created`,
          relatedId: newEvent._id,
          relatedType: "Event"
        });
      }

      res.status(201).json(newEvent);

    } catch (err) {
      console.error("Error creating event:", err.message);
      res.status(400).json({ error: err.message });
    }
  }
);
app.put("/edit-event/:eventId", upload.single("image"), authenticateUser, async (req, res) => {
  const { eventId } = req.params;

  let eventData = { ...req.body };

  // Parse ticketTypes if provided as string
  if (eventData.ticketTypes && typeof eventData.ticketTypes === "string") {
    try {
      eventData.ticketTypes = JSON.parse(eventData.ticketTypes);
    } catch (err) {
      return res.status(400).json({ error: "Invalid ticketTypes format" });
    }
  }

  // Handle image upload if any
  if (req.file) {
    eventData.image = `uploads/${req.file.filename}`;
  }

  try {
    const updatedEvent = await Event.findByIdAndUpdate(eventId, eventData, {
      new: true,
      runValidators: true
    });

    if (!updatedEvent) {
      return res.status(404).json({ error: "Event not found" });
    }

    res.json(updatedEvent);

  } catch (err) {
    console.error("Error updating event:", err.message);
    res.status(500).json({ error: "Failed to update event" });
  }
});
// Approve Event (Admin Only)
app.put("/approveEvent/:eventId", authenticateUser, isAdmin, async (req, res) => {
  const { eventId } = req.params;

  try {
    // Fetch event with owner populated
    const event = await Event.findById(eventId).populate("owner");
    
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Approve event
    event.approved = true;
    await event.save();

    // Create notification for organizer
    if (event.owner && event.owner._id) {
      await Notification.create({
        userId: event.owner._id,
        message: `Your event "${event.title}" has been approved.`,
        relatedId: event._id,
        relatedType: "Event"
      });
    } else {
      console.warn("Owner not found or missing for event:", eventId);
    }

    res.status(200).json({ message: "Event approved successfully", event });
  } catch (error) {
    console.error("Error approving event:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get All Events (Public Access with Filtering)
app.get("/events", async (req, res) => {
  try {
    // Check if the user is authenticated
    const token = req.cookies.token;
    let query = {};

    if (token) {
      // If authenticated, verify the token and determine the user's role
      jwt.verify(token, jwtSecret, (err, userData) => {
        if (err) return; // Token is invalid; treat as unauthenticated

        // Authenticated user: Filter based on role
        if (userData.role === "user") {
          query.approved = true; // Regular users see only approved events
        }
        // Admins and organizers see all events (no filtering)
      });
    } else {
      // Unauthenticated user: Only show approved events
      query.approved = true;
    }

    // Fetch events based on the query
    const events = await Event.find(query);
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

// GET /notifications
app.get("/notifications", authenticateUser, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.id })
      .sort({ createdAt: -1 });

    res.json(notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});
// PUT /notifications/:notificationId/read
app.put("/notifications/:notificationId/read", authenticateUser, async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findById(notificationId);

    if (!notification || notification.userId.toString() !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    notification.read = true;
    await notification.save();

    res.json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ error: "Failed to update notification" });
  }
});
app.put("/notifications/read-all", authenticateUser, async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user.id },
      { read: true }
    );

    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({ error: "Failed to update notifications" });
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

app.put("/event/:eventId", upload.single("image"), authenticateUser, canModifyEvent, async (req, res) => {
  const { eventId } = req.params;
  const updates = req.body;

  try {
    const event = await Event.findById(eventId);
    if (!event) {
      console.log("Event not found:", eventId);
      return res.status(404).json({ error: "Event not found" });
    }

    if (req.file) {
      updates.image = `uploads/${req.file.filename}`;
    }

    Object.assign(event, updates);
    await event.save();
    console.log("Event updated successfully:", event);
    res.json(event);
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).json({ error: "Failed to update event" });
  }
});

app.post("/save-event/:eventId", authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const eventId = req.params.eventId;

  try {
    const user = await UserModel.findById(userId);

    if (!user.savedEvents.includes(eventId)) {
      user.savedEvents.push(eventId);
      await user.save();
    }

    res.json({ message: "Event saved successfully", savedEvents: user.savedEvents });
  } catch (error) {
    console.error("Error saving event:", error);
    res.status(500).json({ error: "Server error" });
  }
});
app.delete("/unsave-event/:eventId", authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const eventId = req.params.eventId;

  try {
    const user = await UserModel.findById(userId);
    user.savedEvents = user.savedEvents.filter(id => id.toString() !== eventId);
    await user.save();

    res.json({ message: "Event removed from save list", savedEvents: user.savedEvents });
  } catch (error) {
    console.error("Error unsaving event:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Reject Event (Admin Only)
app.put("/rejectEvent/:eventId", authenticateUser, isAdmin, async (req, res) => {
  const { eventId } = req.params;
  const event = await Event.findById(req.params.eventId).populate("owner");
  await Notification.create({
    userId: event.owner._id,
    message: `Your event "${event.title}" has been rejected.`,
    relatedId: event._id,
    relatedType: "Event"
  });
  try {
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    event.approved = false;
    await event.save();
    res.status(200).json({ message: "Event rejected successfully", event });
  } catch (error) {
    console.error("Error rejecting event:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// Delete Event (Organizer or Admin who owns the event)
app.delete("/event/:eventId", authenticateUser, canModifyEvent, async (req, res) => {
  const { eventId } = req.params;

  try {
    const event = await Event.findByIdAndDelete(eventId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    res.status(200).json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get Events by Organizer ID
app.get("/events/organizer/:organizerId", authenticateUser, async (req, res) => {
  try {
    const ownerId = new mongoose.Types.ObjectId(req.params.organizerId);
    const events = await Event.find({ owner: ownerId });

    if (!events.length) {
      return res.json([]);
    }

    const eventIds = events.map(event => event._id.toString());
    const tickets = await Ticket.find({ eventid: { $in: eventIds } });

    const enrichedEvents = events.map(event => {
      const eventStrId = event._id.toString();
      const eventTickets = tickets.filter(t => t.eventid === eventStrId);

      const breakdown = {
        General: 0,
        FanFest: 0,
        VIP: 0,
        earnings: 0
      };

      eventTickets.forEach(ticket => {
        const ticketType = ticket.ticketDetails?.ticketType || "General";
        const quantity = parseInt(ticket.count || 1);
        const ticketTypeData = event.ticketTypes.find(t => t.name === ticketType);
        const basePrice = ticketTypeData ? ticketTypeData.price : 0;

        const purchaseDate = new Date(ticket.createdAt);
        const activePhase = event.salePhases?.find(phase => {
          const start = new Date(phase.startDate);
          const end = new Date(phase.endDate);
          return purchaseDate >= start && purchaseDate <= end;
        });

        const finalPrice = activePhase
          ? Math.round(basePrice * (1 - activePhase.discountPercent / 100))
          : basePrice;

        if (['General', 'FanFest', 'VIP'].includes(ticketType)) {
          breakdown[ticketType] += quantity;
          breakdown.earnings += finalPrice * quantity;
        }
      });

      return {
        ...event.toObject(),
        breakdown
      };
    });

    res.status(200).json(enrichedEvents);

  } catch (error) {
    console.error("Error fetching organizer events:", error.message);
    res.status(500).json({ error: "Failed to load events" });
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
// Get Platform-Wide Analytics (Admin Only)
app.get("/admin/analytics", authenticateUser, isAdmin, async (req, res) => {
  try {
    const totalEvents = await Event.countDocuments();
    const totalTicketsSold = await Ticket.aggregate([
      { $group: { _id: null, total: { $sum: "$count" } } },
    ]);
    const totalEarnings = await Ticket.aggregate([
      { $group: { _id: null, total: { $sum: "$ticketDetails.ticketprice" } } },
    ]);
   
    const totalOrganizers = await UserModel.countDocuments({ role: "organizer" });
    res.status(200).json({
      totalEvents,
      totalTicketsSold: totalTicketsSold[0]?.total || 0,
      totalEarnings: totalEarnings[0]?.total || 0,
      totalOrganizers,
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// Get Organizer-Specific Analytics
app.get("/organizer/analytics", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    // Step 1: Get all events owned by user
    const events = await Event.find({ owner: userId });
    const eventIds = events.map(event => event._id);

    // Step 2: Get all tickets for those events
    const tickets = await Ticket.find({ eventid: { $in: eventIds } });

    // Step 3: Initialize counters
    const ticketTypeStats = {
      General: { sold: 0, earnings: 0 },
      FanFest: { sold: 0, earnings: 0 },
      VIP: { sold: 0, earnings: 0 }
    };

    let totalTicketsSold = 0;
    let totalEarnings = 0;

    // Step 4: Process each ticket
    for (const ticket of tickets) {
      const event = await Event.findById(ticket.eventid);
      if (!event) continue;

      const ticketType = ticket.ticketDetails?.ticketType;
      if (!['General', 'FanFest', 'VIP'].includes(ticketType)) continue;

      const ticketTypeData = event.ticketTypes.find(t => t.name === ticketType);
      if (!ticketTypeData) continue;

      const basePrice = ticketTypeData.price;
      const quantity = parseInt(ticket.count || 1);
      const purchaseDate = new Date(ticket.createdAt);

      // Apply phase discount if applicable
      const activePhase = event.salePhases?.find(phase => {
        const start = new Date(phase.startDate);
        const end = new Date(phase.endDate);
        return purchaseDate >= start && purchaseDate <= end;
      });

      const finalPrice = activePhase
        ? Math.round(basePrice * (1 - activePhase.discountPercent / 100))
        : basePrice;

      // Update stats
      ticketTypeStats[ticketType].sold += quantity;
      ticketTypeStats[ticketType].earnings += finalPrice * quantity;

      totalTicketsSold += quantity;
      totalEarnings += finalPrice * quantity;
    }

    // Step 5: Return detailed analytics
    res.status(200).json({
      totalEvents: events.length,
      totalTicketsSold,
      totalEarnings,
      breakdown: ticketTypeStats
    });

  } catch (error) {
    console.error("Error fetching organizer analytics:", error.message);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});
app.post('/event/:eventId/comment', authenticateUser, async (req, res) => {
  const { eventId } = req.params;
  const { text } = req.body;
  const userId = req.user.id;

  try {
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const user = await UserModel.findById(userId).select('name email');
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const newComment = {
      text,
      user: userId,
      createdAt: new Date()
    };

    event.comments.push(newComment);
    await event.save();

    // Return the comment with user details
    res.status(201).json({
      _id: newComment._id,
      text: newComment.text,
      createdAt: newComment.createdAt,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// Get comments for an event
// Get comments for an event
app.get('/event/:eventId/comments', async (req, res) => {
  const { eventId } = req.params;

  try {
    const event = await Event.findById(eventId).populate({
      path: 'comments.user',
      select: 'name email' // Only select name and email
    });
    
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Map through comments to ensure consistent structure
    const formattedComments = event.comments.map(comment => ({
      _id: comment._id,
      text: comment.text,
      createdAt: comment.createdAt,
      user: {
        _id: comment.user._id,
        name: comment.user.name,
        email: comment.user.email
      }
    }));

    res.status(200).json(formattedComments);
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});
// Start the Server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
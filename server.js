const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files from public directory
app.use(express.static('public'));
app.use(cors());

// Specific routes for documentation pages
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/how-it-works', (req, res) => {
  res.sendFile(__dirname + '/public/how-it-works.html');
});

app.get('/about', (req, res) => {
  res.sendFile(__dirname + '/public/about.html');
});

app.get('/contact', (req, res) => {
  res.sendFile(__dirname + '/public/contact.html');
});

app.get('/faq', (req, res) => {
  res.sendFile(__dirname + '/public/faq.html');
});

app.get('/blog', (req, res) => {
  res.sendFile(__dirname + '/public/blog.html');
});

app.get('/resources', (req, res) => {
  res.sendFile(__dirname + '/public/resources.html');
});

app.get('/use-cases', (req, res) => {
  res.sendFile(__dirname + '/public/use-cases.html');
});

app.get('/privacy-policy', (req, res) => {
  res.sendFile(__dirname + '/public/privacy-policy.html');
});

app.get('/chats', (req, res) => {
  res.sendFile(__dirname + '/public/chats.html');
});

app.get('/settings', (req, res) => {
  res.sendFile(__dirname + '/public/settings.html');
});

// Language-specific routes
app.get('/language/:lang', (req, res) => {
  const lang = req.params.lang;
  const filePath = __dirname + `/public/language/${lang}.html`;
  res.sendFile(filePath, (err) => {
    if (err) {
      // If language file doesn't exist, serve the main index.html
      res.sendFile(__dirname + '/public/index.html');
    }
  });
});

// Room routes (for the chat app)
app.get('/room/:roomId', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Catch-all route for client-side routing (must be LAST)
app.get('*', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Store active rooms and their participants
const rooms = new Map();

// Room cleanup timer (5 minutes)
const ROOM_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Function to translate text using Groq API
async function translateText(text, sourceLang, targetLang) {
  try {
    // Only proceed if we have an API key
    if (!process.env.GROQ_API_KEY) {
      console.warn('No GROQ_API_KEY found, returning original text');
      return text;
    }
    
    // Map language codes to language names
    const languageMap = {
      'en': 'English',
      'ar': 'Arabic',
      'ur': 'Urdu',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ru': 'Russian',
      'zh': 'Chinese (Simplified)',
      'ja': 'Japanese',
      'ko': 'Korean',
      'hi': 'Hindi',
      'tr': 'Turkish',
      'nl': 'Dutch',
      'pl': 'Polish',
      'sv': 'Swedish',
      'fi': 'Finnish',
      'da': 'Danish',
      'no': 'Norwegian',
      'cs': 'Czech',
      'id': 'Indonesian'
    };
    
    const sourceLangName = languageMap[sourceLang] || 'English';
    const targetLangName = languageMap[targetLang] || 'Arabic';
    
    // Create prompt for translation
    const prompt = `Translate this casual chat message from ${sourceLangName} to ${targetLangName}. Give a natural, conversational translation without quotes or extra explanation:\n${text}`;
    
    console.log(`Translating: ${text} from ${sourceLangName} to ${targetLangName}`);
    
    // Call Groq API (FIXED: removed extra space in URL)
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.3,
      max_tokens: 1024,
      top_p: 1,
      stream: false,
      stop: null
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Extract translated text and strip any quotes
    let translatedText = response.data.choices[0].message.content.trim();
    translatedText = translatedText.replace(/^["']|["']$/g, '');
    console.log(`Translation result: ${translatedText}`);
    return translatedText;
  } catch (error) {
    console.error('Translation error:', error.response?.data || error.message);
    return text; // Return original text if translation fails
  }
}

// Socket connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Create a new chat room
  socket.on('create-room', (data) => {
    const { username, userLanguage, partnerLanguage } = data;
    
    // Generate a new room ID (8 characters)
    let roomId;
    do {
      roomId = uuidv4().substring(0, 8);
    } while (rooms.has(roomId)); // Ensure uniqueness
    
    // Create room with creator as first participant
    rooms.set(roomId, {
      id: roomId,
      participants: [{
        id: socket.id,
        username: username,
        language: userLanguage,
        joinedAt: new Date()
      }],
      creatorLanguage: userLanguage,      // Store creator's language
      partnerLanguage: partnerLanguage,    // Store partner's language
      createdAt: new Date(),
      timeout: setTimeout(() => {
        // Delete room after timeout if not full
        if (rooms.has(roomId) && rooms.get(roomId).participants.length < 2) {
          rooms.delete(roomId);
          io.to(roomId).emit('room-expired');
        }
      }, ROOM_TIMEOUT)
    });

    // Join the room
    socket.join(roomId);
    
    // Send room info to creator
    socket.emit('room-created', {
      roomId,
      creatorLanguage: userLanguage,
      partnerLanguage: partnerLanguage
    });
    
    console.log(`Room created: ${roomId} with creator language: ${userLanguage}, partner language: ${partnerLanguage}`);
  });

  // Get room info for joiners (for automatic language selection)
  socket.on('get-room-info', (data) => {
    const { roomId } = data;
    
    // Check if room exists
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      
      // Send room language info to joiner
      socket.emit('room-info', {
        creatorLanguage: room.creatorLanguage,
        partnerLanguage: room.partnerLanguage
      });
      
      console.log(`Sent room info for room: ${roomId}`);
    } else {
      socket.emit('error', { message: 'Room not found' });
    }
  });

  // Join an existing room
  socket.on('join-room', (data) => {
    const { roomId, username, language } = data;
    
    // Check if room exists
    if (!rooms.has(roomId)) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    const room = rooms.get(roomId);
    
    // Check if room is full
    if (room.participants.length >= 2) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }
    
    // Clear timeout since room is now full
    clearTimeout(room.timeout);
    
    // Add participant to room (use the language they specified)
    room.participants.push({
      id: socket.id,
      username: username,
      language: language,
      joinedAt: new Date()
    });
    
    // Join the room
    socket.join(roomId);
    
    // Notify other participant
    const otherParticipant = room.participants.find(p => p.id !== socket.id);
    if (otherParticipant) {
      io.to(otherParticipant.id).emit('user-joined', {
        username: username,
        language: language
      });
    }
    
    // Send room info to joiner (include the other user's info)
    socket.emit('joined-room', {
      roomId,
      otherUser: otherParticipant ? {
        username: otherParticipant.username,
        language: otherParticipant.language
      } : null
    });
    
    console.log(`User ${username} joined room: ${roomId} with language: ${language}`);
  });

  // Handle sending messages
  socket.on('send-message', async (data) => {
    const { roomId, message } = data;
    
    // Check if room exists
    if (!rooms.has(roomId)) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    const room = rooms.get(roomId);
    const sender = room.participants.find(p => p.id === socket.id);
    const receiver = room.participants.find(p => p.id !== socket.id);
    
    if (!sender || !receiver) {
      socket.emit('error', { message: 'Participant not found' });
      return;
    }
    
    console.log(`Translating message from ${sender.language} to ${receiver.language}`);
    
    // Translate message from sender's language to receiver's language
    const translatedMessage = await translateText(
      message, 
      sender.language, 
      receiver.language
    );
    
    // Emit message to sender (show what they sent)
    socket.emit('message-received', {
      message,
      translatedMessage,
      username: 'You',
      timestamp: new Date(),
      isOwn: true
    });
    
    // Emit message to receiver (show translation in their language)
    io.to(receiver.id).emit('message-received', {
      message,
      translatedMessage,
      username: sender.username,
      timestamp: new Date(),
      isOwn: false
    });
  });

  // Handle user ending chat intentionally
  socket.on('end-chat', (data) => {
    const { roomId } = data;
    
    if (!rooms.has(roomId)) {
      return;
    }
    
    const room = rooms.get(roomId);
    const participant = room.participants.find(p => p.id === socket.id);
    
    if (participant) {
      // Notify the other participant that this user ended the chat
      const otherParticipant = room.participants.find(p => p.id !== socket.id);
      if (otherParticipant) {
        io.to(otherParticipant.id).emit('chat-ended', {
          username: participant.username,
          reason: 'ended'
        });
      }
      
      // Notify the user who ended the chat to return to setup
      socket.emit('return-to-setup');
      
      // Remove this participant from the room
      room.participants = room.participants.filter(p => p.id !== socket.id);
      
      // If room is now empty, delete it
      if (room.participants.length === 0) {
        clearTimeout(room.timeout);
        rooms.delete(roomId);
      }
    }
    
    console.log(`User ${participant ? participant.username : 'unknown'} ended chat in room: ${roomId}`);
  });

  // Handle disconnection (network loss, browser close, etc.)
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove user from any rooms they were in
    for (const [roomId, room] of rooms.entries()) {
      const participantIndex = room.participants.findIndex(p => p.id === socket.id);
      
      if (participantIndex !== -1) {
        const participant = room.participants[participantIndex];
        room.participants.splice(participantIndex, 1);
        
        // Notify remaining participant that this user left
        if (room.participants.length > 0) {
          io.to(room.participants[0].id).emit('user-left', {
            username: participant.username
          });
        }
        // If room is now empty, delete it
        else {
          clearTimeout(room.timeout);
          rooms.delete(roomId);
        }
        
        console.log(`User ${participant.username} left room: ${roomId}`);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (!process.env.GROQ_API_KEY) {
    console.warn('Warning: GROQ_API_KEY not found in environment variables. Translation will not work.');
  }
});
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
})

// Oda ve kullanıcı yönetimi
const rooms = new Map()  // roomId -> { name, users: Map<socketId, userInfo> }

function getRoomList() {
  const list = []
  rooms.forEach((room, id) => {
    list.push({
      id,
      name: room.name,
      userCount: room.users.size,
      users: Array.from(room.users.values()).map(u => ({ id: u.id, name: u.name, muted: u.muted }))
    })
  })
  return list
}

app.get('/health', (req, res) => res.json({ status: 'ok' }))
app.get('/rooms', (req, res) => res.json(getRoomList()))

io.on('connection', (socket) => {
  console.log('Bağlandı:', socket.id)

  let currentRoom = null
  let userInfo = null

  // Oda listesi iste
  socket.on('get-rooms', () => {
    socket.emit('room-list', getRoomList())
  })

  // Odaya katıl
  socket.on('join-room', ({ roomId, roomName, userName }) => {
    if (currentRoom) {
      leaveCurrentRoom()
    }

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { name: roomName || roomId, users: new Map() })
    }

    const room = rooms.get(roomId)
    userInfo = { id: socket.id, name: userName, muted: false, roomId }
    room.users.set(socket.id, userInfo)
    currentRoom = roomId

    socket.join(roomId)

    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      userName,
      users: Array.from(room.users.values())
    })

    socket.emit('joined-room', {
      roomId,
      roomName: room.name,
      users: Array.from(room.users.values()),
      myId: socket.id
    })

    io.emit('room-list', getRoomList())

    console.log(`${userName} → ${roomId} odasına katıldı`)
  })

  // WebRTC Sinyalizasyon (ses)
  socket.on('offer', ({ to, offer }) => {
    socket.to(to).emit('offer', { from: socket.id, offer })
  })

  socket.on('answer', ({ to, answer }) => {
    socket.to(to).emit('answer', { from: socket.id, answer })
  })

  socket.on('ice-candidate', ({ to, candidate }) => {
    socket.to(to).emit('ice-candidate', { from: socket.id, candidate })
  })

  // Ses durumu
  socket.on('toggle-mute', ({ muted }) => {
    if (currentRoom && userInfo) {
      userInfo.muted = muted
      const room = rooms.get(currentRoom)
      if (room) room.users.set(socket.id, userInfo)
      socket.to(currentRoom).emit('user-muted', { userId: socket.id, muted })
    }
  })

  // Konuşma tespiti
  socket.on('speaking', ({ speaking }) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('user-speaking', { userId: socket.id, speaking })
    }
  })

  // ── Metin Sohbet ──────────────────────────────
  socket.on('chat-message', ({ roomId, text, userName, userId }) => {
    if (!roomId || !text) return
    io.to(roomId).emit('chat-message', {
      userId,
      userName,
      text: text.slice(0, 1000),
      timestamp: Date.now()
    })
  })

  // ── Ekran Paylaşımı Sinyalleri ────────────────
  socket.on('screen-offer', ({ to, offer }) => {
    socket.to(to).emit('screen-offer', { from: socket.id, offer })
  })

  socket.on('screen-answer', ({ to, answer }) => {
    socket.to(to).emit('screen-answer', { from: socket.id, answer })
  })

  socket.on('screen-ice', ({ to, candidate }) => {
    socket.to(to).emit('screen-ice', { from: socket.id, candidate })
  })

  socket.on('screen-started', ({ roomId, userName }) => {
    socket.to(roomId).emit('screen-started', { userId: socket.id, userName })
  })

  socket.on('screen-stopped', ({ roomId }) => {
    socket.to(roomId).emit('screen-stopped', { userId: socket.id })
  })

  // ─────────────────────────────────────────────

  // Odadan ayrıl
  function leaveCurrentRoom() {
    if (!currentRoom) return
    const room = rooms.get(currentRoom)
    if (room) {
      room.users.delete(socket.id)
      socket.to(currentRoom).emit('user-left', { userId: socket.id, userName: userInfo?.name })
      if (room.users.size === 0) {
        rooms.delete(currentRoom)
      }
    }
    socket.leave(currentRoom)
    currentRoom = null
    userInfo = null
    io.emit('room-list', getRoomList())
  }

  socket.on('leave-room', leaveCurrentRoom)

  socket.on('disconnect', () => {
    leaveCurrentRoom()
    console.log('Ayrıldı:', socket.id)
  })
})

const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`VoiceCord sunucu çalışıyor: http://localhost:${PORT}`)
})

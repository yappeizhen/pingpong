import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
  type Firestore,
} from 'firebase/firestore'
import { getDb, isFirebaseEnabled } from '@/services/firebase'
import type { Room, RoomData, RoomPlayer, RoomState } from './types'

const ROOMS_PATH = ['pingponghub', 'rooms', 'active'] as const

const getRoomsCollection = (db: Firestore) => collection(db, ...ROOMS_PATH)
const getRoomDoc = (db: Firestore, roomId: string) => doc(db, ...ROOMS_PATH, roomId)
const getRoomSignaling = (db: Firestore, roomId: string) => collection(db, ...ROOMS_PATH, roomId, 'signaling')

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ROOM_CODE_LENGTH = 4

export function generateRoomCode(): string {
  let code = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]
  }
  return code
}

export function generateSeed(): number {
  return Math.floor(Math.random() * 1000000)
}

export function getPlayerId(): string {
  const key = 'pingpong_player_id'
  let playerId = localStorage.getItem(key)
  if (!playerId) {
    playerId = `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    localStorage.setItem(key, playerId)
  }
  return playerId
}

export function getPlayerName(): string {
  const stored = localStorage.getItem('pingpong_username')
  return stored || `Player${Math.floor(Math.random() * 1000)}`
}

export function setPlayerName(name: string): void {
  localStorage.setItem('pingpong_username', name)
}

export async function createRoom(playerName: string): Promise<Room | null> {
  if (!isFirebaseEnabled()) return null

  const db = getDb()
  if (!db) return null

  const playerId = getPlayerId()
  const roomCode = generateRoomCode()
  const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const initialPlayer: RoomPlayer = {
    id: playerId,
    name: playerName,
    score: 0,
    connected: true,
    lastActivity: Date.now(),
    isHost: true,
  }

  const roomData: RoomData = {
    code: roomCode,
    state: 'waiting',
    hostId: playerId,
    seed: generateSeed(),
    createdAt: Date.now(),
    players: {
      [playerId]: initialPlayer,
    },
  }

  try {
    await setDoc(getRoomDoc(db, roomId), roomData)
    return {
      id: roomId,
      ...roomData,
    }
  } catch (error) {
    console.error('[Multiplayer] createRoom error:', error)
    return null
  }
}

export async function findRoomByCode(code: string): Promise<Room | null> {
  if (!isFirebaseEnabled()) return null

  const db = getDb()
  if (!db) return null

  const upperCode = code.toUpperCase()

  try {
    const q = query(
      getRoomsCollection(db),
      where('code', '==', upperCode),
      where('state', '==', 'waiting')
    )
    const snapshot = await getDocs(q)

    if (snapshot.empty) return null

    const roomDoc = snapshot.docs[0]
    const data = roomDoc.data() as RoomData

    return {
      id: roomDoc.id,
      ...data,
    }
  } catch (error) {
    console.error('[Multiplayer] findRoomByCode error:', error)
    return null
  }
}

export async function joinRoom(roomId: string, playerName: string): Promise<boolean> {
  if (!isFirebaseEnabled()) return false

  const db = getDb()
  if (!db) return false

  const playerId = getPlayerId()

  const newPlayer: RoomPlayer = {
    id: playerId,
    name: playerName,
    score: 0,
    connected: true,
    lastActivity: Date.now(),
    isHost: false,
  }

  try {
    const roomRef = getRoomDoc(db, roomId)
    const snapshot = await getDoc(roomRef)

    if (!snapshot.exists()) return false

    const roomData = snapshot.data() as RoomData
    const playerCount = Object.keys(roomData.players || {}).length

    if (playerCount >= 2) return false
    if (roomData.state !== 'waiting') return false

    await updateDoc(roomRef, {
      [`players.${playerId}`]: newPlayer,
    })

    return true
  } catch {
    return false
  }
}

export async function leaveRoom(roomId: string): Promise<void> {
  if (!isFirebaseEnabled()) return

  const db = getDb()
  if (!db) return

  const playerId = getPlayerId()

  try {
    const roomRef = getRoomDoc(db, roomId)
    const snapshot = await getDoc(roomRef)

    if (!snapshot.exists()) return

    const roomData = snapshot.data() as RoomData
    const playerCount = Object.keys(roomData.players || {}).length

    if (playerCount <= 1) {
      await deleteDoc(roomRef)
      
      try {
        const signalingDocs = await getDocs(getRoomSignaling(db, roomId))
        const deletePromises = signalingDocs.docs.map((d) => deleteDoc(d.ref))
        await Promise.all(deletePromises)
      } catch {
        // Ignore signaling cleanup errors
      }
    } else {
      const updatedPlayers = { ...roomData.players }
      delete updatedPlayers[playerId]

      const updates: Record<string, unknown> = { players: updatedPlayers }

      if (roomData.hostId === playerId) {
        const remainingPlayers = Object.keys(updatedPlayers)
        if (remainingPlayers.length > 0) {
          updates.hostId = remainingPlayers[0]
          updates[`players.${remainingPlayers[0]}.isHost`] = true
        }
      }

      await updateDoc(roomRef, updates)
    }
  } catch {
    // Ignore leave errors
  }
}

export async function updateRoomState(roomId: string, state: RoomState): Promise<void> {
  if (!isFirebaseEnabled()) return

  const db = getDb()
  if (!db) return

  try {
    const updates: Record<string, unknown> = { state }
    
    if (state === 'playing') {
      updates.startedAt = Date.now()
    } else if (state === 'finished') {
      updates.endedAt = Date.now()
    }
    
    await updateDoc(getRoomDoc(db, roomId), updates)
  } catch {
    // Ignore update errors
  }
}

export async function updatePlayerScore(
  roomId: string,
  playerId: string,
  score: number
): Promise<void> {
  if (!isFirebaseEnabled()) return

  const db = getDb()
  if (!db) return

  try {
    await updateDoc(getRoomDoc(db, roomId), {
      [`players.${playerId}.score`]: score,
      [`players.${playerId}.lastActivity`]: Date.now(),
    })
  } catch {
    // Ignore score update errors
  }
}

export async function setGameWinner(roomId: string, winnerId: string): Promise<void> {
  if (!isFirebaseEnabled()) return

  const db = getDb()
  if (!db) return

  try {
    await updateDoc(getRoomDoc(db, roomId), {
      state: 'finished' as RoomState,
      winnerId,
      endedAt: Date.now(),
    })
  } catch {
    // Ignore winner update errors
  }
}

export function subscribeToRoom(
  roomId: string,
  callback: (room: Room | null) => void
): Unsubscribe {
  const db = getDb()
  if (!db) {
    callback(null)
    return () => {}
  }

  return onSnapshot(
    getRoomDoc(db, roomId),
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null)
        return
      }

      const data = snapshot.data() as RoomData
      callback({
        id: roomId,
        ...data,
      })
    },
    () => {
      callback(null)
    }
  )
}

export async function setPlayerConnected(
  roomId: string,
  connected: boolean
): Promise<void> {
  if (!isFirebaseEnabled()) return

  const db = getDb()
  if (!db) return

  const playerId = getPlayerId()

  try {
    await updateDoc(getRoomDoc(db, roomId), {
      [`players.${playerId}.connected`]: connected,
      [`players.${playerId}.lastActivity`]: Date.now(),
    })
  } catch {
    // Ignore connection status update errors
  }
}

export async function cleanupStaleRooms(): Promise<void> {
  if (!isFirebaseEnabled()) return

  const db = getDb()
  if (!db) return

  const WAITING_STALE_MS = 10 * 60 * 1000 // 10 minutes
  const FINISHED_STALE_MS = 2 * 60 * 1000 // 2 minutes

  try {
    const snapshot = await getDocs(getRoomsCollection(db))

    const now = Date.now()
    const deletePromises: Promise<void>[] = []

    snapshot.forEach((docSnap) => {
      const room = docSnap.data() as RoomData
      const age = now - room.createdAt

      if (room.state === 'waiting' && age > WAITING_STALE_MS) {
        deletePromises.push(deleteDoc(getRoomDoc(db, docSnap.id)))
      }

      if (room.state === 'finished' && room.endedAt) {
        const finishedAge = now - room.endedAt
        if (finishedAge > FINISHED_STALE_MS) {
          deletePromises.push(deleteDoc(getRoomDoc(db, docSnap.id)))
        }
      }
    })

    await Promise.all(deletePromises)
  } catch {
    // Ignore cleanup errors
  }
}

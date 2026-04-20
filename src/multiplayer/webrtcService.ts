import {
  doc,
  collection,
  setDoc,
  onSnapshot,
  deleteDoc,
  getDocs,
  type Unsubscribe,
} from 'firebase/firestore'
import { getDb, isFirebaseEnabled } from '@/services/firebase'
import type { WebRTCConnection } from './types'

const ROOMS_PATH = ['pingponghub', 'rooms', 'active'] as const

let cachedIceServers: RTCConfiguration | null = null
let cacheTimestamp: number = 0
const CACHE_TTL_MS = 5 * 60 * 1000

export function clearIceServerCache(): void {
  cachedIceServers = null
  cacheTimestamp = 0
}

async function fetchIceServers(): Promise<RTCConfiguration> {
  const now = Date.now()
  if (cachedIceServers && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedIceServers
  }
  
  cachedIceServers = null

  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]

  const apiKey = import.meta.env.VITE_METERED_API_KEY
  const appName = import.meta.env.VITE_METERED_APP_NAME || 'frootninja'

  if (apiKey) {
    try {
      const response = await fetch(
        `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
      )
      
      if (response.ok) {
        const turnServers = await response.json()
        iceServers.push(...turnServers)
      }
    } catch {
      // Fall back to static credentials
    }
  }
  
  // Fallback to static credentials if API failed
  if (iceServers.length <= 2) {
    const turnUsername = import.meta.env.VITE_TURN_USERNAME
    const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL
    
    if (turnUsername && turnCredential) {
      iceServers.push(
        {
          urls: 'turns:global.relay.metered.ca:443?transport=tcp',
          username: turnUsername,
          credential: turnCredential,
        },
        {
          urls: 'turn:global.relay.metered.ca:443?transport=tcp',
          username: turnUsername,
          credential: turnCredential,
        },
        {
          urls: 'turn:global.relay.metered.ca:80',
          username: turnUsername,
          credential: turnCredential,
        }
      )
    }
  }

  const config: RTCConfiguration = {
    iceServers,
    iceCandidatePoolSize: 10,
  }

  cachedIceServers = config
  cacheTimestamp = Date.now()
  return cachedIceServers
}

export async function createPeerConnection(
  roomId: string,
  playerId: string,
  isHost: boolean,
  localStream: MediaStream,
  onRemoteStream: (stream: MediaStream) => void,
  onDataChannel: (channel: RTCDataChannel) => void
): Promise<WebRTCConnection | null> {
  if (!isFirebaseEnabled()) return null

  const db = getDb()
  if (!db) return null

  const iceConfig = await fetchIceServers()
  const pc = new RTCPeerConnection(iceConfig)
  const unsubscribes: Unsubscribe[] = []
  let remoteStream: MediaStream | null = null
  let dataChannel: RTCDataChannel | null = null

  const pendingIceCandidates: RTCIceCandidateInit[] = []
  let remoteDescriptionSet = false

  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream)
  })

  pc.ontrack = (event) => {
    if (!remoteStream) {
      remoteStream = new MediaStream()
    }
    remoteStream.addTrack(event.track)
    onRemoteStream(remoteStream)
  }

  const signalingDoc = doc(db, ...ROOMS_PATH, roomId, 'signaling', playerId)
  const remoteSigDoc = doc(db, ...ROOMS_PATH, roomId, 'signaling', isHost ? 'guest' : 'host')
  const iceCandidatesCol = collection(db, ...ROOMS_PATH, roomId, 'signaling', playerId, 'iceCandidates')
  const remoteIceCol = collection(db, ...ROOMS_PATH, roomId, 'signaling', isHost ? 'guest' : 'host', 'iceCandidates')

  try {
    await deleteDoc(signalingDoc)
  } catch {
    // Doc might not exist
  }

  try {
    const oldCandidates = await getDocs(iceCandidatesCol)
    const deletePromises = oldCandidates.docs.map((d) => deleteDoc(d.ref))
    await Promise.all(deletePromises)
  } catch {
    // Collection might not exist
  }

  const addIceCandidate = async (candidateData: RTCIceCandidateInit) => {
    if (!remoteDescriptionSet) {
      pendingIceCandidates.push(candidateData)
      return
    }
    try {
      const candidate = new RTCIceCandidate(candidateData)
      await pc.addIceCandidate(candidate)
    } catch {
      // Ignore ICE candidate errors
    }
  }

  const flushPendingIceCandidates = async () => {
    remoteDescriptionSet = true
    for (const candidateData of pendingIceCandidates) {
      try {
        const candidate = new RTCIceCandidate(candidateData)
        await pc.addIceCandidate(candidate)
      } catch {
        // Ignore ICE candidate errors
      }
    }
    pendingIceCandidates.length = 0
  }

  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      try {
        const candidateId = Date.now().toString()
        const candidateDoc = doc(iceCandidatesCol, candidateId)
        await setDoc(candidateDoc, event.candidate.toJSON())
      } catch {
        // Ignore ICE candidate send errors
      }
    }
  }

  const processedCandidates = new Set<string>()

  const processCandidateDoc = (docId: string, candidateData: RTCIceCandidateInit) => {
    if (processedCandidates.has(docId)) return
    processedCandidates.add(docId)
    addIceCandidate(candidateData)
  }

  const pollRemoteCandidates = async () => {
    try {
      const snapshot = await getDocs(remoteIceCol)
      snapshot.docs.forEach(d => {
        processCandidateDoc(d.id, d.data() as RTCIceCandidateInit)
      })
    } catch {
      // Ignore polling errors
    }
  }

  const pollInterval = setInterval(pollRemoteCandidates, 1500)
  setTimeout(() => clearInterval(pollInterval), 15000)

  const unsubIce = onSnapshot(remoteIceCol, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidateData = change.doc.data() as RTCIceCandidateInit
        processCandidateDoc(change.doc.id, candidateData)
      }
    })
  })
  unsubscribes.push(unsubIce)
  unsubscribes.push(() => clearInterval(pollInterval))

  try {
    if (isHost) {
      dataChannel = pc.createDataChannel('gameSync', {
        ordered: false,
        maxRetransmits: 0,
      })
      
      dataChannel.onopen = () => {
        onDataChannel(dataChannel!)
      }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      await setDoc(signalingDoc, {
        type: 'offer',
        sdp: offer.sdp,
        timestamp: Date.now(),
      })

      const unsubAnswer = onSnapshot(remoteSigDoc, async (snapshot) => {
        const data = snapshot.data()
        if (data?.type === 'answer' && pc.signalingState === 'have-local-offer') {
          try {
            await pc.setRemoteDescription(
              new RTCSessionDescription({
                type: 'answer',
                sdp: data.sdp,
              })
            )
            await flushPendingIceCandidates()
          } catch {
            // Ignore description errors
          }
        }
      })
      unsubscribes.push(unsubAnswer)
    } else {
      pc.ondatachannel = (event) => {
        dataChannel = event.channel
        
        dataChannel.onopen = () => {
          onDataChannel(dataChannel!)
        }
      }

      const unsubOffer = onSnapshot(remoteSigDoc, async (snapshot) => {
        const data = snapshot.data()
        if (data?.type === 'offer' && pc.signalingState === 'stable') {
          try {
            await pc.setRemoteDescription(
              new RTCSessionDescription({
                type: 'offer',
                sdp: data.sdp,
              })
            )
            await flushPendingIceCandidates()

            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)

            await setDoc(signalingDoc, {
              type: 'answer',
              sdp: answer.sdp,
              timestamp: Date.now(),
            })
          } catch {
            // Ignore offer processing errors
          }
        }
      })
      unsubscribes.push(unsubOffer)
    }
  } catch {
    pc.close()
    return null
  }

  return {
    peerConnection: pc,
    dataChannel,
    localStream,
    remoteStream,
    unsubscribes,
  }
}

export async function closePeerConnection(
  connection: WebRTCConnection | null,
  roomId: string,
  playerId: string
): Promise<void> {
  if (!connection) return

  connection.unsubscribes.forEach((unsub) => unsub())

  if (connection.dataChannel) {
    connection.dataChannel.close()
  }

  connection.peerConnection.close()

  if (isFirebaseEnabled()) {
    const db = getDb()
    if (db) {
      try {
        await deleteDoc(doc(db, ...ROOMS_PATH, roomId, 'signaling', playerId))
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

export async function getLocalMediaStream(): Promise<MediaStream | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
        facingMode: 'user',
      },
      audio: false,
    })
    return stream
  } catch {
    return null
  }
}

export function stopMediaStream(stream: MediaStream | null): void {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop())
  }
}

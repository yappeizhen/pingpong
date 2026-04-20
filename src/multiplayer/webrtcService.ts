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

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
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

  const pc = new RTCPeerConnection(ICE_SERVERS)
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

  const unsubIce = onSnapshot(remoteIceCol, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added' && !processedCandidates.has(change.doc.id)) {
        processedCandidates.add(change.doc.id)
        const candidateData = change.doc.data() as RTCIceCandidateInit
        addIceCandidate(candidateData)
      }
    })
  })
  unsubscribes.push(unsubIce)

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

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
  if (!isFirebaseEnabled()) {
    console.warn('[WebRTC] Firebase not enabled')
    return null
  }

  const db = getDb()
  if (!db) {
    console.error('[WebRTC] No database instance')
    return null
  }

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
    console.log('[WebRTC] Received remote track')
    if (!remoteStream) {
      remoteStream = new MediaStream()
    }
    remoteStream.addTrack(event.track)
    onRemoteStream(remoteStream)
  }

  const signalingDoc = doc(db, 'rooms', roomId, 'signaling', playerId)
  const remoteSigDoc = doc(db, 'rooms', roomId, 'signaling', isHost ? 'guest' : 'host')
  const iceCandidatesCol = collection(db, 'rooms', roomId, 'signaling', playerId, 'iceCandidates')
  const remoteIceCol = collection(db, 'rooms', roomId, 'signaling', isHost ? 'guest' : 'host', 'iceCandidates')

  try {
    await deleteDoc(signalingDoc)
    console.log('[WebRTC] Cleaned up old signaling data')
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

  pc.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection state:', pc.connectionState)
  }

  pc.oniceconnectionstatechange = () => {
    console.log('[WebRTC] ICE state:', pc.iceConnectionState)
  }

  const addIceCandidate = async (candidateData: RTCIceCandidateInit) => {
    if (!remoteDescriptionSet) {
      pendingIceCandidates.push(candidateData)
      return
    }
    try {
      const candidate = new RTCIceCandidate(candidateData)
      await pc.addIceCandidate(candidate)
    } catch (error) {
      console.error('[WebRTC] Failed to add ICE candidate:', error)
    }
  }

  const flushPendingIceCandidates = async () => {
    remoteDescriptionSet = true
    for (const candidateData of pendingIceCandidates) {
      try {
        const candidate = new RTCIceCandidate(candidateData)
        await pc.addIceCandidate(candidate)
      } catch (error) {
        console.error('[WebRTC] Failed to add queued ICE candidate:', error)
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
      } catch (error) {
        console.error('[WebRTC] Failed to send ICE candidate:', error)
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
        console.log('[WebRTC] Data channel opened (host)')
        onDataChannel(dataChannel!)
      }

      console.log('[WebRTC] Host creating offer...')
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      await setDoc(signalingDoc, {
        type: 'offer',
        sdp: offer.sdp,
        timestamp: Date.now(),
      })
      console.log('[WebRTC] Host sent offer')

      const unsubAnswer = onSnapshot(remoteSigDoc, async (snapshot) => {
        const data = snapshot.data()
        if (data?.type === 'answer' && pc.signalingState === 'have-local-offer') {
          try {
            console.log('[WebRTC] Host processing answer...')
            await pc.setRemoteDescription(
              new RTCSessionDescription({
                type: 'answer',
                sdp: data.sdp,
              })
            )
            await flushPendingIceCandidates()
            console.log('[WebRTC] Host connection established')
          } catch (error) {
            console.error('[WebRTC] Host failed to set remote description:', error)
          }
        }
      })
      unsubscribes.push(unsubAnswer)
    } else {
      pc.ondatachannel = (event) => {
        console.log('[WebRTC] Received data channel (guest)')
        dataChannel = event.channel
        
        dataChannel.onopen = () => {
          console.log('[WebRTC] Data channel opened (guest)')
          onDataChannel(dataChannel!)
        }
      }

      console.log('[WebRTC] Guest waiting for offer...')
      const unsubOffer = onSnapshot(remoteSigDoc, async (snapshot) => {
        const data = snapshot.data()
        if (data?.type === 'offer' && pc.signalingState === 'stable') {
          try {
            console.log('[WebRTC] Guest processing offer...')
            await pc.setRemoteDescription(
              new RTCSessionDescription({
                type: 'offer',
                sdp: data.sdp,
              })
            )
            await flushPendingIceCandidates()

            console.log('[WebRTC] Guest creating answer...')
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)

            await setDoc(signalingDoc, {
              type: 'answer',
              sdp: answer.sdp,
              timestamp: Date.now(),
            })
            console.log('[WebRTC] Guest sent answer')
          } catch (error) {
            console.error('[WebRTC] Guest failed to process offer:', error)
          }
        }
      })
      unsubscribes.push(unsubOffer)
    }
  } catch (error) {
    console.error('[WebRTC] Signaling failed:', error)
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
        await deleteDoc(doc(db, 'rooms', roomId, 'signaling', playerId))
      } catch (error) {
        console.error('[WebRTC] Failed to cleanup signaling:', error)
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
  } catch (error) {
    console.error('[WebRTC] Failed to get local media:', error)
    return null
  }
}

export function stopMediaStream(stream: MediaStream | null): void {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop())
  }
}

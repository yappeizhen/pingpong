/**
 * WebRTC Service for P2P Video Streaming
 * Handles peer-to-peer video connection between players
 */

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

const ROOMS_PATH = ['pingponghub', 'rooms', 'active'] as const

// ICE servers cache (with expiry to handle quota changes)
let cachedIceServers: RTCConfiguration | null = null
let cacheTimestamp: number = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function clearIceServerCache(): void {
  cachedIceServers = null
  cacheTimestamp = 0
  console.log('[WebRTC] ICE server cache cleared')
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
  const appName = import.meta.env.VITE_METERED_APP_NAME || 'pingponghub'

  if (apiKey) {
    try {
      console.log('[WebRTC] Fetching TURN credentials from Metered API...')
      const response = await fetch(
        `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
      )

      if (response.ok) {
        const turnServers = await response.json()
        iceServers.push(...turnServers)
        console.log('[WebRTC] Fetched TURN servers from API ✓', turnServers.length, 'servers')
      } else if (response.status === 402 || response.status === 429) {
        console.warn('[WebRTC] TURN quota exceeded (status', response.status, ') - using STUN only')
      } else {
        console.error('[WebRTC] API response error:', response.status)
      }
    } catch (error) {
      console.error('[WebRTC] Failed to fetch from API:', error)
      console.log('[WebRTC] Falling back to static credentials')
    }
  }

  // Fallback to static credentials if API failed or not configured
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
      console.log('[WebRTC] Using static TURN credentials ✓')
    } else {
      console.log('[WebRTC] No TURN configured - STUN only')
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

import type { WebRTCConnection } from './types'

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

  const iceConfig = await fetchIceServers()
  const pc = new RTCPeerConnection(iceConfig)
  const unsubscribes: Unsubscribe[] = []
  let remoteStream: MediaStream | null = null
  let dataChannel: RTCDataChannel | null = null
  let transientDataChannel: RTCDataChannel | null = null
  let reliableDataChannel: RTCDataChannel | null = null

  const pendingIceCandidates: RTCIceCandidateInit[] = []
  let remoteDescriptionSet = false

  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream)
  })

  pc.ontrack = (event) => {
    console.log('[WebRTC] Remote track received')
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

  // Clean up stale signaling data
  try {
    await deleteDoc(signalingDoc)
    console.log('[WebRTC] Cleaned up old signaling data for', playerId)
  } catch {
    // Doc might not exist
  }

  try {
    const oldCandidates = await getDocs(iceCandidatesCol)
    const deletePromises = oldCandidates.docs.map((d) => deleteDoc(d.ref))
    if (deletePromises.length > 0) {
      await Promise.all(deletePromises)
      console.log('[WebRTC] Cleaned up', deletePromises.length, 'old ICE candidates')
    }
  } catch {
    // Collection might not exist
  }

  // Track ICE restart state
  let iceRestartInProgress = false
  let iceRestartAttempts = 0
  const MAX_ICE_RESTART_ATTEMPTS = 3

  const performIceRestart = async () => {
    if (iceRestartInProgress) {
      console.log('[WebRTC] ICE restart already in progress, skipping')
      return
    }

    if (iceRestartAttempts >= MAX_ICE_RESTART_ATTEMPTS) {
      console.error('[WebRTC] Max ICE restart attempts reached, giving up')
      return
    }

    iceRestartInProgress = true
    iceRestartAttempts++
    console.log('[WebRTC] Starting ICE restart attempt', iceRestartAttempts, '/', MAX_ICE_RESTART_ATTEMPTS)

    try {
      if (isHost) {
        console.log('[WebRTC] Host creating ICE restart offer...')
        const offer = await pc.createOffer({ iceRestart: true })
        await pc.setLocalDescription(offer)

        await setDoc(signalingDoc, {
          type: 'offer',
          sdp: offer.sdp,
          timestamp: Date.now(),
          iceRestart: true,
        })
        console.log('[WebRTC] Host sent ICE restart offer')
      } else {
        console.log('[WebRTC] Guest calling restartIce(), waiting for host offer...')
        pc.restartIce()
      }
    } catch (error) {
      console.error('[WebRTC] ICE restart failed:', error)
    } finally {
      setTimeout(() => {
        iceRestartInProgress = false
      }, 5000)
    }
  }

  // Connection state monitoring
  pc.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection state:', pc.connectionState)
    if (pc.connectionState === 'connected') {
      iceRestartAttempts = 0
    }
    if (pc.connectionState === 'failed') {
      console.error('[WebRTC] Connection failed - attempting ICE restart')
      clearIceServerCache()
      performIceRestart()
    }
  }

  let disconnectedTimeout: ReturnType<typeof setTimeout> | null = null

  pc.oniceconnectionstatechange = () => {
    console.log('[WebRTC] ICE state:', pc.iceConnectionState)

    if (disconnectedTimeout) {
      clearTimeout(disconnectedTimeout)
      disconnectedTimeout = null
    }

    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      iceRestartAttempts = 0
    }

    if (pc.iceConnectionState === 'failed') {
      console.log('[WebRTC] ICE failed, clearing cache and attempting restart...')
      clearIceServerCache()
      performIceRestart()
    }

    if (pc.iceConnectionState === 'disconnected') {
      console.log('[WebRTC] ICE disconnected, waiting 10s to see if it recovers...')
      disconnectedTimeout = setTimeout(() => {
        if (pc.iceConnectionState === 'disconnected') {
          console.log('[WebRTC] ICE still disconnected after 10s, attempting restart...')
          clearIceServerCache()
          performIceRestart()
        }
      }, 10000)
    }
  }

  pc.onsignalingstatechange = () => {
    console.log('[WebRTC] Signaling state:', pc.signalingState)
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
    console.log('[WebRTC] Flushing', pendingIceCandidates.length, 'pending ICE candidates')
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

  console.log('[WebRTC] Will store ICE candidates at:', `${ROOMS_PATH.join('/')}/${roomId}/signaling/${playerId}/iceCandidates`)

  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      const c = event.candidate
      console.log('[WebRTC] Local ICE candidate:', c.type, c.protocol, c.address)
      if (c.type === 'relay') {
        console.log('[WebRTC] ✓ TURN relay candidate generated!')
      }
      try {
        const candidateId = Date.now().toString()
        const candidateDoc = doc(iceCandidatesCol, candidateId)
        await setDoc(candidateDoc, event.candidate.toJSON())
      } catch (error) {
        console.error('[WebRTC] Failed to send ICE candidate:', error)
      }
    } else {
      console.log('[WebRTC] ICE candidate gathering complete')
    }
  }

  pc.onicegatheringstatechange = () => {
    console.log('[WebRTC] ICE gathering state:', pc.iceGatheringState)
  }

  const remoteIcePath = `${ROOMS_PATH.join('/')}/${roomId}/signaling/${isHost ? 'guest' : 'host'}/iceCandidates`
  console.log('[WebRTC] Setting up listener for remote ICE candidates at:', remoteIcePath)

  const processedCandidates = new Set<string>()

  const processCandidateDoc = (docId: string, candidateData: RTCIceCandidateInit) => {
    if (processedCandidates.has(docId)) return
    processedCandidates.add(docId)
    console.log('[WebRTC] Processing remote ICE candidate:', docId)
    addIceCandidate(candidateData)
  }

  const pollRemoteCandidates = async () => {
    try {
      const snapshot = await getDocs(remoteIceCol)
      console.log('[WebRTC] Polling remote ICE candidates:', snapshot.size, 'docs found,', processedCandidates.size, 'already processed')
      snapshot.docs.forEach((d) => {
        processCandidateDoc(d.id, d.data() as RTCIceCandidateInit)
      })
    } catch {
      // Ignore polling errors
    }
  }

  const pollInterval = setInterval(pollRemoteCandidates, 1500)
  setTimeout(() => clearInterval(pollInterval), 15000)

  const unsubIce = onSnapshot(remoteIceCol, (snapshot) => {
    console.log('[WebRTC] Remote ICE snapshot received, docs:', snapshot.size, 'changes:', snapshot.docChanges().length)
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidateData = change.doc.data() as RTCIceCandidateInit
        processCandidateDoc(change.doc.id, candidateData)
      }
    })
  }, (error) => {
    console.error('[WebRTC] Error listening for remote ICE candidates:', error)
  })

  unsubscribes.push(unsubIce)
  unsubscribes.push(() => clearInterval(pollInterval))

  try {
    const wireDataChannel = (channel: RTCDataChannel) => {
      if (channel.label === 'gameSyncReliable') {
        reliableDataChannel = channel
      } else {
        transientDataChannel = channel
        dataChannel = channel
      }

      channel.onopen = () => {
        console.log('[WebRTC] Data channel open:', channel.label)
        onDataChannel(channel)
      }

      if (channel.readyState === 'open') {
        onDataChannel(channel)
      }
    }

    if (isHost) {
      transientDataChannel = pc.createDataChannel('gameSyncTransient', {
        ordered: false,
        maxRetransmits: 0,
      })
      reliableDataChannel = pc.createDataChannel('gameSyncReliable', {
        ordered: true,
      })
      dataChannel = transientDataChannel

      wireDataChannel(transientDataChannel)
      wireDataChannel(reliableDataChannel)

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
        console.log('[WebRTC] Host received data:', data?.type, 'signalingState:', pc.signalingState)
        if (data?.type === 'answer' && pc.signalingState === 'have-local-offer') {
          try {
            console.log('[WebRTC] Host processing answer...')
            await pc.setRemoteDescription(
              new RTCSessionDescription({
                type: 'answer',
                sdp: data.sdp,
              })
            )
            console.log('[WebRTC] Host set remote description, flushing ICE candidates...')
            await flushPendingIceCandidates()
            console.log('[WebRTC] Host ready!')
            iceRestartInProgress = false
          } catch (error) {
            console.error('[WebRTC] Host failed to set remote description:', error)
          }
        }
      })
      unsubscribes.push(unsubAnswer)
    } else {
      pc.ondatachannel = (event) => {
        const incomingChannel = event.channel
        if (incomingChannel.label !== 'gameSyncReliable') {
          dataChannel = incomingChannel
        }
        wireDataChannel(incomingChannel)
      }

      console.log('[WebRTC] Guest waiting for offer...')
      let lastOfferTimestamp = 0

      const unsubOffer = onSnapshot(remoteSigDoc, async (snapshot) => {
        const data = snapshot.data()
        console.log('[WebRTC] Guest received data:', data?.type, 'signalingState:', pc.signalingState, 'iceRestart:', data?.iceRestart)

        const isNewOffer = data?.timestamp && data.timestamp > lastOfferTimestamp
        const canAccept = pc.signalingState === 'stable' || (data?.iceRestart && isNewOffer)

        if (data?.type === 'offer' && canAccept) {
          lastOfferTimestamp = data.timestamp || Date.now()

          try {
            console.log('[WebRTC] Guest processing offer...', data.iceRestart ? '(ICE restart)' : '')
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
              iceRestart: data.iceRestart || false,
            })
            console.log('[WebRTC] Guest sent answer!')
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
    dataChannels: {
      transient: transientDataChannel,
      reliable: reliableDataChannel,
    },
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
  connection.dataChannels?.transient?.close()
  connection.dataChannels?.reliable?.close()

  connection.peerConnection.close()

  if (isFirebaseEnabled()) {
    const db = getDb()
    if (db) {
      try {
        await deleteDoc(doc(db, ...ROOMS_PATH, roomId, 'signaling', playerId))
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
    console.error('[WebRTC] Failed to get local media stream:', error)
    return null
  }
}

export function stopMediaStream(stream: MediaStream | null): void {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop())
  }
}

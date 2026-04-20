/**
 * useWebRTC Hook
 * React hook for managing WebRTC video connection
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPeerConnection, closePeerConnection } from './webrtcService'
import type { WebRTCConnection } from './types'

interface UseWebRTCOptions {
  roomId: string | null
  isHost: boolean
  localStream: MediaStream | null
  enabled: boolean
  onDataChannel?: (channel: RTCDataChannel) => void
}

export function useWebRTC({ roomId, isHost, localStream, enabled, onDataChannel }: UseWebRTCOptions) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | 'idle'>('idle')
  const [reconnectTrigger, setReconnectTrigger] = useState(0)
  const connectionRef = useRef<WebRTCConnection | null>(null)
  
  // Store current values in refs for unmount cleanup and stable callbacks
  const roomIdRef = useRef(roomId)
  const isHostRef = useRef(isHost)
  const onDataChannelRef = useRef(onDataChannel)
  roomIdRef.current = roomId
  isHostRef.current = isHost
  onDataChannelRef.current = onDataChannel

  // Track component unmount - this runs ONLY on unmount
  useEffect(() => {
    return () => {
      // Clean up connection on true unmount
      if (connectionRef.current && roomIdRef.current) {
        console.log('[useWebRTC] Component unmounting, closing connection')
        closePeerConnection(connectionRef.current, roomIdRef.current, isHostRef.current ? 'host' : 'guest')
        connectionRef.current = null
      }
    }
  }, []) // Empty deps = only runs on mount/unmount

  // Stable callbacks using refs - never change identity
  const handleRemoteStream = useCallback((stream: MediaStream) => {
    console.log('[useWebRTC] Remote stream received')
    setRemoteStream(stream)
  }, [])

  const handleDataChannel = useCallback((channel: RTCDataChannel) => {
    console.log('[useWebRTC] Data channel ready')
    onDataChannelRef.current?.(channel)
  }, []) // Empty deps - uses ref for latest callback

  const reconnect = useCallback(() => {
    if (connectionRef.current && roomId) {
      console.log('[useWebRTC] Reconnecting...')
      closePeerConnection(connectionRef.current, roomId, isHost ? 'host' : 'guest')
      connectionRef.current = null
      setRemoteStream(null)
      setConnectionState('idle')
    }
    setReconnectTrigger(prev => prev + 1)
  }, [roomId, isHost])

  useEffect(() => {
    console.log('[useWebRTC] Effect triggered - enabled:', enabled, 'roomId:', !!roomId, 'localStream:', !!localStream, 'reconnectTrigger:', reconnectTrigger)
    
    if (!enabled || !roomId || !localStream) {
      console.log('[useWebRTC] Not ready, returning early')
      return
    }

    if (connectionRef.current) {
      const state = connectionRef.current.peerConnection.connectionState
      console.log('[useWebRTC] Existing connection state:', state)
      if (state === 'connected' || state === 'connecting') {
        console.log('[useWebRTC] Connection healthy, skipping setup')
        return
      }
      console.log('[useWebRTC] Closing unhealthy connection')
      closePeerConnection(connectionRef.current, roomId, isHost ? 'host' : 'guest')
      connectionRef.current = null
    }

    let mounted = true

    const setupConnection = async () => {
      console.log('[useWebRTC] Setting up connection, isHost:', isHost)
      
      const connection = await createPeerConnection(
        roomId,
        isHost ? 'host' : 'guest',
        isHost,
        localStream,
        handleRemoteStream,
        handleDataChannel
      )

      if (!mounted) {
        if (connection) {
          closePeerConnection(connection, roomId, isHost ? 'host' : 'guest')
        }
        return
      }

      if (connection) {
        connectionRef.current = connection

        let failedStateCount = 0

        connection.peerConnection.onconnectionstatechange = () => {
          const state = connection.peerConnection.connectionState
          console.log('[useWebRTC] Connection state:', state)
          setConnectionState(state)

          if (state === 'connected') {
            failedStateCount = 0
          } else if (state === 'failed') {
            failedStateCount++
            if (failedStateCount >= 2) {
              console.log('[useWebRTC] Connection failed multiple times, triggering full reconnect...')
              setTimeout(() => {
                if (connectionRef.current?.peerConnection.connectionState === 'failed') {
                  reconnect()
                }
              }, 5000)
            }
          }
        }

        setConnectionState(connection.peerConnection.connectionState)
      }
    }

    setupConnection()

    return () => {
      console.log('[useWebRTC] Effect cleanup triggered, mounted was:', mounted)
      mounted = false
      // Don't close connection here - let the unmount effect handle true unmounts
      // This cleanup runs on every dependency change, we don't want to break healthy connections
    }
  }, [enabled, roomId, isHost, localStream, handleRemoteStream, handleDataChannel, reconnectTrigger, reconnect])

  return {
    remoteStream,
    connectionState,
    isConnected: connectionState === 'connected',
    reconnect,
  }
}

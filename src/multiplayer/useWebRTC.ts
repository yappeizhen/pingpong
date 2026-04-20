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

  const handleRemoteStream = useCallback((stream: MediaStream) => {
    console.log('[useWebRTC] Remote stream received')
    setRemoteStream(stream)
  }, [])

  const handleDataChannel = useCallback((channel: RTCDataChannel) => {
    console.log('[useWebRTC] Data channel ready')
    onDataChannel?.(channel)
  }, [onDataChannel])

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
      console.log('[useWebRTC] Cleanup triggered, mounted was:', mounted)
      mounted = false
      if (connectionRef.current) {
        console.log('[useWebRTC] Closing connection in cleanup')
        closePeerConnection(connectionRef.current, roomId, isHost ? 'host' : 'guest')
        connectionRef.current = null
        setRemoteStream(null)
        setConnectionState('idle')
      }
    }
  }, [enabled, roomId, isHost, localStream, handleRemoteStream, handleDataChannel, reconnectTrigger, reconnect])

  return {
    remoteStream,
    connectionState,
    isConnected: connectionState === 'connected',
    reconnect,
  }
}

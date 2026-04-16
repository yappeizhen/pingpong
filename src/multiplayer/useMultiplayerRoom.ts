import { useEffect, useCallback, useRef } from 'react'
import { useMultiplayerStore } from '@/state/multiplayerStore'
import {
  createRoom,
  findRoomByCode,
  joinRoom,
  leaveRoom,
  updateRoomState,
  subscribeToRoom,
  getPlayerId,
  cleanupStaleRooms,
  setPlayerConnected,
} from './multiplayerService'
import type { RoomPlayer, RoomState } from './types'

export function useMultiplayerRoom() {
  const store = useMultiplayerStore()
  const unsubscribeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!store.roomId) {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
      return
    }

    unsubscribeRef.current = subscribeToRoom(store.roomId, (room) => {
      if (!room) {
        store.reset()
        return
      }

      const playerId = getPlayerId()
      const players = Object.values(room.players || {})
      const opponent = players.find((p) => p.id !== playerId) || null

      store.setRoom(room)
      store.setOpponent(opponent)
      store.setRoomState(room.state)
      store.setIsHost(room.hostId === playerId)
    })

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [store.roomId])

  useEffect(() => {
    cleanupStaleRooms()
  }, [])

  const handleCreateRoom = useCallback(
    async (playerName: string): Promise<string | null> => {
      const room = await createRoom(playerName)
      if (room) {
        store.setRoomId(room.id)
        store.setRoomCode(room.code)
        store.setIsHost(true)
        store.setLocalPlayerId(getPlayerId())
        return room.code
      }
      return null
    },
    []
  )

  const handleJoinRoom = useCallback(
    async (code: string, playerName: string): Promise<boolean> => {
      const room = await findRoomByCode(code)
      if (!room) {
        return false
      }

      const success = await joinRoom(room.id, playerName)
      if (success) {
        store.setRoomId(room.id)
        store.setRoomCode(room.code)
        store.setIsHost(false)
        store.setLocalPlayerId(getPlayerId())
        return true
      }
      return false
    },
    []
  )

  const handleLeaveRoom = useCallback(async () => {
    if (store.roomId) {
      await leaveRoom(store.roomId)
    }
    store.reset()
  }, [store.roomId])

  const handleUpdateRoomState = useCallback(
    async (state: RoomState) => {
      if (store.roomId) {
        await updateRoomState(store.roomId, state)
      }
    },
    [store.roomId]
  )

  const handleSetConnected = useCallback(
    async (connected: boolean) => {
      if (store.roomId) {
        await setPlayerConnected(store.roomId, connected)
      }
    },
    [store.roomId]
  )

  const getLocalPlayer = useCallback((): RoomPlayer | null => {
    if (!store.room) return null
    const playerId = getPlayerId()
    return store.room.players[playerId] || null
  }, [store.room])

  const hasBothPlayers = useCallback((): boolean => {
    if (!store.room) return false
    const players = Object.values(store.room.players || {})
    return players.length === 2
  }, [store.room])

  const getWinner = useCallback((): {
    isWinner: boolean
    isTie: boolean
    winnerId: string | null
  } => {
    if (!store.room || store.room.state !== 'finished') {
      return { isWinner: false, isTie: false, winnerId: null }
    }

    const playerId = getPlayerId()
    const winnerId = store.room.winnerId || null
    const isTie = !winnerId
    const isWinner = winnerId === playerId

    return { isWinner, isTie, winnerId }
  }, [store.room])

  return {
    roomId: store.roomId,
    roomCode: store.roomCode,
    roomState: store.roomState,
    room: store.room,
    isHost: store.isHost,
    isConnected: store.isConnected,
    opponent: store.opponent,
    opponentPaddle: store.opponentPaddle,
    remoteBallState: store.remoteBallState,
    remoteStream: store.remoteStream,
    dataChannel: store.dataChannel,
    connectionError: store.connectionError,

    localPlayer: getLocalPlayer(),
    hasBothPlayers: hasBothPlayers(),
    winner: getWinner(),

    createRoom: handleCreateRoom,
    joinRoom: handleJoinRoom,
    leaveRoom: handleLeaveRoom,
    updateRoomState: handleUpdateRoomState,
    setConnected: handleSetConnected,
    
    setOpponentPaddle: store.setOpponentPaddle,
    setRemoteBallState: store.setRemoteBallState,
    setRemoteStream: store.setRemoteStream,
    setDataChannel: store.setDataChannel,
    setConnectionError: store.setConnectionError,
    reset: store.reset,
  }
}

import { create } from 'zustand'
import type { Room, RoomPlayer, RoomState, MultiplayerState } from '@/multiplayer/types'
import type { PaddleState, BallState } from '@/types/game'

const initialPaddle: PaddleState = {
  position: { x: 0.5, y: 0.5 },
  velocity: { x: 0, y: 0 },
  isActive: false,
  isSwinging: false,
  swipeSpeed: 0,
  hand: null,
}

interface MultiplayerStore extends MultiplayerState {
  setRoomId: (roomId: string | null) => void
  setRoomCode: (roomCode: string | null) => void
  setRoom: (room: Room | null) => void
  setRoomState: (state: RoomState) => void
  setIsHost: (isHost: boolean) => void
  setIsConnected: (isConnected: boolean) => void
  setLocalPlayerId: (playerId: string) => void
  setOpponent: (opponent: RoomPlayer | null) => void
  setOpponentPaddle: (paddle: PaddleState) => void
  setRemoteBallState: (ball: BallState | null) => void
  setRemoteStream: (stream: MediaStream | null) => void
  setDataChannel: (channel: RTCDataChannel | null) => void
  setConnectionError: (error: string | null) => void
  reset: () => void
}

const initialState: MultiplayerState = {
  roomId: null,
  roomCode: null,
  room: null,
  roomState: 'waiting',
  isHost: false,
  isConnected: false,
  localPlayerId: null,
  opponent: null,
  opponentPaddle: initialPaddle,
  remoteBallState: null,
  remoteStream: null,
  dataChannel: null,
  connectionError: null,
}

export const useMultiplayerStore = create<MultiplayerStore>()((set) => ({
  ...initialState,

  setRoomId: (roomId) => set({ roomId, isConnected: !!roomId }),
  setRoomCode: (roomCode) => set({ roomCode }),
  setRoom: (room) => set({ room }),
  setRoomState: (roomState) => set({ roomState }),
  setIsHost: (isHost) => set({ isHost }),
  setIsConnected: (isConnected) => set({ isConnected }),
  setLocalPlayerId: (localPlayerId) => set({ localPlayerId }),
  setOpponent: (opponent) => set({ opponent }),
  setOpponentPaddle: (opponentPaddle) => set({ opponentPaddle }),
  setRemoteBallState: (remoteBallState) => set({ remoteBallState }),
  setRemoteStream: (remoteStream) => set({ remoteStream }),
  setDataChannel: (dataChannel) => set({ dataChannel }),
  setConnectionError: (connectionError) => set({ connectionError }),
  reset: () => set({ ...initialState }),
}))

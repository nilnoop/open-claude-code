import { create } from "zustand";
import type {
  PermissionRequest,
} from "@/features/session-workbench/permission-types";

export interface PermissionsState {
  pendingRequest: PermissionRequest | null;
  setPendingPermission: (request: PermissionRequest | null) => void;
  clearPendingPermission: (requestId: string) => void;
}

export const initialState = {
  pendingRequest: null,
} satisfies Pick<PermissionsState, "pendingRequest">;

export const usePermissionsStore = create<PermissionsState>((set, get) => ({
  ...initialState,
  setPendingPermission: (pendingRequest) => set({ pendingRequest }),
  clearPendingPermission: (requestId) => {
    const request = get().pendingRequest;

    if (!request || request.id !== requestId) {
      return;
    }

    set({
      pendingRequest: null,
    });
  },
}));

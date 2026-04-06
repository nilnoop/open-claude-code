import { create } from "zustand";
import type {
  PermissionAction,
  PermissionRequest,
} from "@/features/session-workbench/permission-types";

export interface PermissionsState {
  pendingRequest: PermissionRequest | null;
  setPendingPermission: (request: PermissionRequest | null) => void;
  resolvePermission: (payload: {
    requestId: string;
    decision: PermissionAction;
  }) => void;
}

export const initialState = {
  pendingRequest: null,
} satisfies Pick<PermissionsState, "pendingRequest">;

export const usePermissionsStore = create<PermissionsState>((set, get) => ({
  ...initialState,
  setPendingPermission: (pendingRequest) => set({ pendingRequest }),
  resolvePermission: ({ requestId }) => {
    const request = get().pendingRequest;

    if (!request || request.id !== requestId) {
      return;
    }

    set({
      pendingRequest: null,
    });
  },
}));

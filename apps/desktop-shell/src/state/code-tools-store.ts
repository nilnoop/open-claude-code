import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  CODE_TOOL_IDS,
  DEFAULT_CODE_TOOL,
  type CodeToolId,
  type SelectedCodeToolModel,
} from "@/features/code-tools";
import { namespacedStorage, readLegacyPersistedSlice } from "./store-helpers";

const MAX_DIRECTORIES = 10;

export interface CodeToolsState {
  selectedCliTool: CodeToolId;
  selectedModels: Record<CodeToolId, SelectedCodeToolModel | null>;
  environmentVariables: Record<CodeToolId, string>;
  directories: string[];
  currentDirectory: string;
  selectedTerminal: string;
  setSelectedCliTool: (tool: CodeToolId) => void;
  setSelectedTerminal: (terminal: string) => void;
  setSelectedModel: (model: SelectedCodeToolModel | null) => void;
  setEnvironmentVariables: (value: string) => void;
  addDirectory: (directory: string) => void;
  removeDirectory: (directory: string) => void;
  setCurrentDirectory: (directory: string) => void;
  clearDirectories: () => void;
  resetCodeTools: () => void;
}

type PersistedCodeToolsState = Pick<
  CodeToolsState,
  | "selectedCliTool"
  | "selectedModels"
  | "environmentVariables"
  | "directories"
  | "currentDirectory"
  | "selectedTerminal"
>;

function createSelectionRecord<T>(initialValue: T): Record<CodeToolId, T> {
  return CODE_TOOL_IDS.reduce(
    (acc, toolId) => {
      acc[toolId] = initialValue;
      return acc;
    },
    {} as Record<CodeToolId, T>
  );
}

const defaultCodeToolsState: PersistedCodeToolsState = {
  selectedCliTool: DEFAULT_CODE_TOOL,
  selectedModels: createSelectionRecord<SelectedCodeToolModel | null>(null),
  environmentVariables: createSelectionRecord(""),
  directories: [],
  currentDirectory: "",
  selectedTerminal: "Terminal",
};

const validCodeToolIds = new Set<string>(CODE_TOOL_IDS);

function normalizeCodeToolsState(
  persisted?: Partial<PersistedCodeToolsState> | null
): PersistedCodeToolsState {
  if (!persisted || typeof persisted !== "object") {
    return defaultCodeToolsState;
  }

  const selectedCliTool =
    typeof persisted.selectedCliTool === "string" &&
    validCodeToolIds.has(persisted.selectedCliTool)
      ? persisted.selectedCliTool
      : DEFAULT_CODE_TOOL;
  const selectedModels =
    persisted.selectedModels && typeof persisted.selectedModels === "object"
      ? (persisted.selectedModels as Partial<
          Record<CodeToolId, SelectedCodeToolModel | null>
        >)
      : {};
  const environmentVariables =
    persisted.environmentVariables &&
    typeof persisted.environmentVariables === "object"
      ? (persisted.environmentVariables as Partial<Record<CodeToolId, string>>)
      : {};

  return {
    selectedCliTool,
    selectedModels: Object.fromEntries(
      CODE_TOOL_IDS.map((toolId) => [toolId, selectedModels[toolId] ?? null])
    ) as Record<CodeToolId, SelectedCodeToolModel | null>,
    environmentVariables: Object.fromEntries(
      CODE_TOOL_IDS.map((toolId) => [
        toolId,
        typeof environmentVariables[toolId] === "string"
          ? environmentVariables[toolId]
          : "",
      ])
    ) as Record<CodeToolId, string>,
    directories: Array.isArray(persisted.directories)
      ? persisted.directories.filter(
          (directory): directory is string => typeof directory === "string"
        )
      : [],
    currentDirectory:
      typeof persisted.currentDirectory === "string"
        ? persisted.currentDirectory
        : "",
    selectedTerminal:
      typeof persisted.selectedTerminal === "string"
        ? persisted.selectedTerminal
        : defaultCodeToolsState.selectedTerminal,
  };
}

function createInitialCodeToolsState() {
  return normalizeCodeToolsState(
    readLegacyPersistedSlice<Partial<PersistedCodeToolsState>>("codeTools")
  );
}

export const useCodeToolsStore = create<CodeToolsState>()(
  persist(
    (set) => ({
      ...createInitialCodeToolsState(),
      setSelectedCliTool: (selectedCliTool) => set({ selectedCliTool }),
      setSelectedTerminal: (selectedTerminal) => set({ selectedTerminal }),
      setSelectedModel: (model) =>
        set((state) => ({
          selectedModels: {
            ...state.selectedModels,
            [state.selectedCliTool]: model,
          },
        })),
      setEnvironmentVariables: (value) =>
        set((state) => ({
          environmentVariables: {
            ...state.environmentVariables,
            [state.selectedCliTool]: value,
          },
        })),
      addDirectory: (directory) => {
        const nextDirectory = directory.trim();

        if (!nextDirectory) {
          return;
        }

        set((state) => ({
          directories: [
            nextDirectory,
            ...state.directories.filter((entry) => entry !== nextDirectory),
          ].slice(0, MAX_DIRECTORIES),
        }));
      },
      removeDirectory: (directory) =>
        set((state) => ({
          directories: state.directories.filter((entry) => entry !== directory),
          currentDirectory:
            state.currentDirectory === directory ? "" : state.currentDirectory,
        })),
      setCurrentDirectory: (directory) => {
        const nextDirectory = directory.trim();

        set((state) => ({
          currentDirectory: nextDirectory,
          directories: nextDirectory
            ? [
                nextDirectory,
                ...state.directories.filter((entry) => entry !== nextDirectory),
              ].slice(0, MAX_DIRECTORIES)
            : state.directories,
        }));
      },
      clearDirectories: () =>
        set({
          directories: [],
          currentDirectory: "",
        }),
      resetCodeTools: () => set(defaultCodeToolsState),
    }),
    {
      name: "state",
      storage: namespacedStorage("code-tools"),
      partialize: (state) => ({
        selectedCliTool: state.selectedCliTool,
        selectedModels: state.selectedModels,
        environmentVariables: state.environmentVariables,
        directories: state.directories,
        currentDirectory: state.currentDirectory,
        selectedTerminal: state.selectedTerminal,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizeCodeToolsState(
          persistedState as Partial<PersistedCodeToolsState> | null
        ),
      }),
    }
  )
);

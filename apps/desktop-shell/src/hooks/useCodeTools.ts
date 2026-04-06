import { open } from "@tauri-apps/plugin-dialog";
import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/store";
import {
  addDirectory,
  clearDirectories,
  removeDirectory,
  resetCodeTools,
  setCurrentDirectory,
  setEnvironmentVariables,
  setSelectedCliTool,
  setSelectedModel,
  setSelectedTerminal,
} from "@/store/slices/codeTools";
import type {
  CodeToolId,
  SelectedCodeToolModel,
} from "@/features/code-tools";
import { toolRequiresModel } from "@/features/code-tools";

export function useCodeTools() {
  const dispatch = useAppDispatch();
  const codeToolsState = useAppSelector((state) => state.codeTools);

  const setCliTool = useCallback(
    (tool: CodeToolId) => {
      dispatch(setSelectedCliTool(tool));
    },
    [dispatch]
  );

  const setModel = useCallback(
    (model: SelectedCodeToolModel | null) => {
      dispatch(setSelectedModel(model));
    },
    [dispatch]
  );

  const setTerminal = useCallback(
    (terminal: string) => {
      dispatch(setSelectedTerminal(terminal));
    },
    [dispatch]
  );

  const setEnvVars = useCallback(
    (envVars: string) => {
      dispatch(setEnvironmentVariables(envVars));
    },
    [dispatch]
  );

  const addDir = useCallback(
    (directory: string) => {
      dispatch(addDirectory(directory));
    },
    [dispatch]
  );

  const removeDir = useCallback(
    (directory: string) => {
      dispatch(removeDirectory(directory));
    },
    [dispatch]
  );

  const setCurrentDir = useCallback(
    (directory: string) => {
      dispatch(setCurrentDirectory(directory));
    },
    [dispatch]
  );

  const clearDirs = useCallback(() => {
    dispatch(clearDirectories());
  }, [dispatch]);

  const resetSettings = useCallback(() => {
    dispatch(resetCodeTools());
  }, [dispatch]);

  const selectFolder = useCallback(async () => {
    const result = await open({
      directory: true,
      multiple: false,
    });

    if (!result || Array.isArray(result)) {
      return null;
    }

    setCurrentDir(result);
    return result;
  }, [setCurrentDir]);

  const selectedModel =
    codeToolsState.selectedModels[codeToolsState.selectedCliTool] ?? null;
  const environmentVariables =
    codeToolsState.environmentVariables[codeToolsState.selectedCliTool] ?? "";
  const requiresModel = toolRequiresModel(codeToolsState.selectedCliTool);
  const canLaunch = Boolean(
    codeToolsState.selectedCliTool &&
      codeToolsState.currentDirectory &&
      (!requiresModel || (selectedModel && selectedModel.hasStoredCredential))
  );

  return {
    selectedCliTool: codeToolsState.selectedCliTool,
    selectedModel,
    selectedTerminal: codeToolsState.selectedTerminal,
    environmentVariables,
    directories: codeToolsState.directories,
    currentDirectory: codeToolsState.currentDirectory,
    canLaunch,
    setCliTool,
    setModel,
    setTerminal,
    setEnvVars,
    addDir,
    removeDir,
    setCurrentDir,
    clearDirs,
    resetSettings,
    selectFolder,
  };
}

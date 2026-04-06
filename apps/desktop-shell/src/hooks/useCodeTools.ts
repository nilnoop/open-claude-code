import { open } from "@tauri-apps/plugin-dialog";
import { toolRequiresModel } from "@/features/code-tools";
import { useCodeToolsStore } from "@/state/code-tools-store";

export function useCodeTools() {
  const selectedCliTool = useCodeToolsStore((state) => state.selectedCliTool);
  const selectedModels = useCodeToolsStore((state) => state.selectedModels);
  const environmentVariablesByTool = useCodeToolsStore(
    (state) => state.environmentVariables
  );
  const directories = useCodeToolsStore((state) => state.directories);
  const currentDirectory = useCodeToolsStore((state) => state.currentDirectory);
  const selectedTerminal = useCodeToolsStore((state) => state.selectedTerminal);
  const setCliTool = useCodeToolsStore((state) => state.setSelectedCliTool);
  const setModel = useCodeToolsStore((state) => state.setSelectedModel);
  const setTerminal = useCodeToolsStore((state) => state.setSelectedTerminal);
  const setEnvVars = useCodeToolsStore((state) => state.setEnvironmentVariables);
  const addDir = useCodeToolsStore((state) => state.addDirectory);
  const removeDir = useCodeToolsStore((state) => state.removeDirectory);
  const setCurrentDir = useCodeToolsStore((state) => state.setCurrentDirectory);
  const clearDirs = useCodeToolsStore((state) => state.clearDirectories);
  const resetSettings = useCodeToolsStore((state) => state.resetCodeTools);

  const selectFolder = async () => {
    const result = await open({
      directory: true,
      multiple: false,
    });

    if (!result || Array.isArray(result)) {
      return null;
    }

    setCurrentDir(result);
    return result;
  };

  const selectedModel = selectedModels[selectedCliTool] ?? null;
  const environmentVariables =
    environmentVariablesByTool[selectedCliTool] ?? "";
  const requiresModel = toolRequiresModel(selectedCliTool);
  const canLaunch = Boolean(
    selectedCliTool &&
      currentDirectory &&
      (!requiresModel || (selectedModel && selectedModel.hasStoredCredential))
  );

  return {
    selectedCliTool,
    selectedModel,
    selectedTerminal,
    environmentVariables,
    directories,
    currentDirectory,
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

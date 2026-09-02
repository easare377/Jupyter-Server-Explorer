import * as vscode from 'vscode';

export async function openResource(uri: vscode.Uri): Promise<void> {
  if (uri.path.toLowerCase().endsWith('.ipynb')) {
    try {
      const notebook = await vscode.workspace.openNotebookDocument(uri);
      await vscode.window.showNotebookDocument(notebook);
      return;
    } catch (error) {
      const install = await vscode.window.showWarningMessage(
        `The native notebook editor could not open this file: ${error instanceof Error ? error.message : String(error)}`,
        'Open as Text',
        'Install Jupyter Extension'
      );
      if (install === 'Install Jupyter Extension') {
        await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-toolsai.jupyter');
        return;
      }
      if (install !== 'Open as Text') {
        return;
      }
    }
  }
  await vscode.commands.executeCommand('vscode.open', uri);
}

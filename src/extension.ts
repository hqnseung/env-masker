import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('Env Masker is now active!');
    vscode.window.showInformationMessage('Env Masker Activated! Open a .env file to test.');

    let activeEditor = vscode.window.activeTextEditor;
    let isEnabled = vscode.workspace.getConfiguration('envMasker').get('enable', true);

    // Create a decoration type that masks text
    let maskingDecorationType: vscode.TextEditorDecorationType;

    function updateDecorationType() {
        if (maskingDecorationType) {
            maskingDecorationType.dispose();
        }

        const config = vscode.workspace.getConfiguration('envMasker');
        const maskColor = config.get<string>('maskColor', 'badge.background');

        let backgroundColor: string | vscode.ThemeColor;
        // Check if it's a hex color or a ThemeColor ID
        if (maskColor.startsWith('#')) {
            backgroundColor = maskColor;
        } else {
            backgroundColor = new vscode.ThemeColor(maskColor);
        }

        maskingDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: backgroundColor,
            color: 'transparent',
            textDecoration: 'none; cursor: pointer;'
        });
    }

    updateDecorationType();

    // Track revealed ranges. 
    // Key format: "URI::StartLine:StartChar-EndChar"
    let revealedKeys: Set<string> = new Set();

    function updateDecorations(allowReveal: boolean = false) {
        if (!activeEditor) {
            return;
        }

        isEnabled = vscode.workspace.getConfiguration('envMasker').get('enable', true);
        if (!isEnabled) {
            activeEditor.setDecorations(maskingDecorationType, []);
            return;
        }

        const doc = activeEditor.document;
        const fileName = doc.fileName.toLowerCase();

        // Determine file type
        let fileType: 'env' | 'json' | null = null;

        if (fileName.endsWith('.env') ||
            fileName.includes('.env.') ||
            doc.languageId === 'properties' ||
            doc.languageId === 'plaintext' ||
            doc.languageId === 'dotenv') {
            fileType = 'env';
        } else if (fileName.endsWith('.json')) {
            fileType = 'json';
        }

        if (!fileType) {
            return;
        }

        const text = doc.getText();
        const maskedRanges: vscode.Range[] = [];
        const uriString = doc.uri.toString();

        let regex: RegExp;
        // Different regex strategies
        if (fileType === 'env') {
            regex = /^\s*(?:export\s+)?([\w\.\-\_]+)\s*=(.*)$/gm;
        } else {
            // JSON: "key": "value"
            // Handle escaped characters inside the value string
            regex = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
        }

        let match;
        while ((match = regex.exec(text))) {
            const value = match[2];

            // Skip empty or trivial values if needed, though empty strings might be secrets too? 
            // Existing logic skipped empty.
            if (!value || value.trim().length === 0) {
                continue;
            }

            let valueStartIndex = 0;
            let valueEndIndex = 0;

            if (fileType === 'env') {
                const matchStart = match.index;
                const matchEnd = match.index + match[0].length;
                valueStartIndex = matchEnd - value.length;
                valueEndIndex = matchEnd;
            } else {
                // For JSON, we need to find where the value actually is within the match
                // Match[0] is roughly: "key": "value"
                const matchText = match[0];
                const key = match[1];

                // We start searching after the key to avoid matching content in the key
                // The key is at the start of the match (plus potentially a quote)
                const keyEndIndexInMatch = matchText.indexOf(key) + key.length;
                const afterKey = matchText.substring(keyEndIndexInMatch);

                // Find the colon and then the opening quote of the value
                const colonIndex = afterKey.indexOf(':');
                const valueQuoteIndex = afterKey.indexOf('"', colonIndex + 1);

                // The absolute start index of the value
                // match.index + length before value
                valueStartIndex = match.index + keyEndIndexInMatch + valueQuoteIndex + 1;
                valueEndIndex = valueStartIndex + value.length;
            }

            const startPos = doc.positionAt(valueStartIndex);
            const endPos = doc.positionAt(valueEndIndex);

            // Unique key including URI
            const key = `${uriString}::${startPos.line}:${startPos.character}-${endPos.character}`;

            const range = new vscode.Range(startPos, endPos);

            // Only reveal if explicitly allowed (user interaction) AND cursor is inside
            if (allowReveal) {
                for (const selection of activeEditor.selections) {
                    if (!selection.isEmpty) {
                        // If selecting text, standard intersection
                        if (range.contains(selection.active) || range.intersection(selection)) {
                            revealedKeys.add(key);
                        }
                    } else {
                        // If just clicking (empty selection)
                        if (range.contains(selection.active) && !selection.active.isEqual(range.end)) {
                            revealedKeys.add(key);
                        }
                    }
                }
            }

            if (!revealedKeys.has(key)) {
                maskedRanges.push(range);
            }
        }

        activeEditor.setDecorations(maskingDecorationType, maskedRanges);
    }

    // Register toggle command
    const toggleCommand = vscode.commands.registerCommand('envMasker.toggle', () => {
        isEnabled = !isEnabled;
        vscode.window.setStatusBarMessage(`Env Masker: ${isEnabled ? 'Enabled' : 'Disabled'}`, 3000);
        updateDecorations(false);
    });
    context.subscriptions.push(toggleCommand);

    const hideAllCommand = vscode.commands.registerCommand('envMasker.hideAll', () => {
        revealedKeys.clear();
        updateDecorations(false);
    });
    context.subscriptions.push(hideAllCommand);

    // Trigger update on activation
    if (activeEditor) {
        updateDecorations(false); // Do not reveal initially
    }

    // Event listeners
    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;
        if (editor) {
            updateDecorations(false); // Do not reveal on tab switch
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (activeEditor && event.document === activeEditor.document) {
            updateDecorations(false); // Typing shouldn't necessarily reveal neighbor lines?
            // Actually if I type into a value, I am likely "interacting" but the selection change handles that.
            // Keeping false here protects against auto-reveals on programmatic edits.
        }
    }, null, context.subscriptions);

    vscode.window.onDidChangeTextEditorSelection(event => {
        if (activeEditor && event.textEditor === activeEditor) {
            // Only allow reveal if the selection change was caused by Mouse, Keyboard, or Command
            // This prevents "TextEditorSelectionChangeKind.Undefined" (e.g. file open/restore) from revealing.
            const isUserInteraction = event.kind === vscode.TextEditorSelectionChangeKind.Mouse ||
                event.kind === vscode.TextEditorSelectionChangeKind.Keyboard ||
                event.kind === vscode.TextEditorSelectionChangeKind.Command;

            updateDecorations(isUserInteraction);
        }
    }, null, context.subscriptions);

    // Clear revealed status when file is closed
    vscode.workspace.onDidCloseTextDocument(doc => {
        const uriPrefix = doc.uri.toString() + '::';
        // Delete all keys starting with this URI
        for (const key of revealedKeys) {
            if (key.startsWith(uriPrefix)) {
                revealedKeys.delete(key);
            }
        }
    }, null, context.subscriptions);

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('envMasker.maskColor') || event.affectsConfiguration('envMasker.enable')) {
            updateDecorationType();
            updateDecorations(false);
        }
    }, null, context.subscriptions);
}

export function deactivate() { }

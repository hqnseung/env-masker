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

        // 1. Check if this is likely an .env file
        const doc = activeEditor.document;
        const isEnvFile = doc.fileName.toLowerCase().endsWith('.env') ||
            doc.fileName.toLowerCase().includes('.env.') ||
            doc.languageId === 'properties' ||
            doc.languageId === 'plaintext' ||
            doc.languageId === 'dotenv'; // Some extensions add this

        if (!isEnvFile) {
            return;
        }

        const text = doc.getText();
        const envRegex = /^\s*(?:export\s+)?([\w\.\-\_]+)\s*=(.*)$/gm;
        const maskedRanges: vscode.Range[] = [];
        const uriString = doc.uri.toString();

        let match;
        while ((match = envRegex.exec(text))) {
            // match[0] is the whole line: KEY=VALUE
            // match[1] is KEY
            // match[2] is VALUE (what we want to mask)

            const value = match[2];
            if (!value || value.trim().length === 0) {
                continue;
            }

            // Calculate start and end position of the VALUE
            // The value starts after the equals sign.
            // match.index is start of line. match[0].indexOf('=') gives relative pos of =.
            // But match[2] is simply the captured group.

            // We can calculate the start index of the value absolute in the file
            // start of match + length of key + length of equals sign (and potential whitespace before value)

            // A safer way to get the exact range of match[2]:
            const matchStart = match.index;
            const matchEnd = match.index + match[0].length;

            // We know match[0] ends with match[2].
            // So the value starts at matchEnd - value.length
            const valueStartIndex = matchEnd - value.length;
            const valueEndIndex = matchEnd;

            // Generate a unique key for this range to track its revealed state
            // "lineIndex" is safer than character offset if file changes, but regex runs on full text.
            // Let's use start/end offset for now as they are recalculated on every edit.
            // Actually, if we edit the file, offsets change.
            // Better to rely on the fact that updateDecorations runs on change.
            // If we use Line number as key, it might be more stable for simple edits.
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
                        // Exclude the 'end' position because clicking whitespace to the right of the line
                        // places the cursor at the end, which triggers a reveal unintendedly.
                        // detailed interaction:
                        // Start point (left edge): Revealed.
                        // End point (right edge): NOT Revealed (to avoid right-whitespace click).
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

'use strict';
import { commands, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { EditorCommand } from './commands';
import { BuiltInCommands, Commands } from '../constants';
import GitProvider, { GitCommit, GitUri } from '../gitProvider';
import { Logger } from '../logger';
import * as path from 'path';

export default class DiffLineWithPreviousCommand extends EditorCommand {

    constructor(private git: GitProvider) {
        super(Commands.DiffLineWithPrevious);
    }

    async execute(editor: TextEditor): Promise<any>;
    async execute(editor: TextEditor, edit: TextEditorEdit, uri: Uri): Promise<any>;
    async execute(editor: TextEditor, edit?: TextEditorEdit, uri?: Uri, commit?: GitCommit, line?: number): Promise<any> {
        if (!(uri instanceof Uri)) {
            if (!editor.document) return undefined;
            uri = editor.document.uri;
        }

        line = line || editor.selection.active.line;
        const gitUri = GitUri.fromUri(uri, this.git);

        if (!commit || GitProvider.isUncommitted(commit.sha)) {
            const blameline = line - gitUri.offset;
            if (blameline < 0) return undefined;

            try {
                const blame = await this.git.getBlameForLine(gitUri.fsPath, blameline, gitUri.sha, gitUri.repoPath);
                if (!blame) return window.showWarningMessage(`Unable to open diff. File is probably not under source control`);

                commit = blame.commit;
                // If the current commit matches the blame, show the previous
                if (gitUri.sha === commit.sha) {
                    commit = new GitCommit(commit.repoPath, commit.previousSha, commit.previousFileName, commit.author, commit.date, commit.message);
                    line = blame.line.line + 1 + gitUri.offset;
                }

                // If the line is uncommitted, find the previous commit and treat it as a DiffWithWorking
                if (commit.isUncommitted) {
                    uri = commit.uri;
                    commit = new GitCommit(commit.repoPath, commit.previousSha, commit.previousFileName, commit.author, commit.date, commit.message);
                    line = blame.line.line + 1 + gitUri.offset;
                    return commands.executeCommand(Commands.DiffWithWorking, uri, commit, line);
                }
            }
            catch (ex) {
                Logger.error('[GitLens.DiffWithPreviousLineCommand]', `getBlameForLine(${blameline})`, ex);
                return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
            }
        }

        try {
            const values = await Promise.all([
                this.git.getVersionedFile(gitUri.fsPath, gitUri.repoPath, gitUri.sha),
                this.git.getVersionedFile(commit.uri.fsPath, commit.repoPath, commit.sha)
            ]);
            await commands.executeCommand(BuiltInCommands.Diff, Uri.file(values[1]), Uri.file(values[0]), `${path.basename(commit.uri.fsPath)} (${commit.sha}) ↔ ${path.basename(gitUri.fsPath)} (${gitUri.sha})`);
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: line, at: 'center' });
        }
        catch (ex) {
            Logger.error('[GitLens.DiffWithPreviousLineCommand]', 'getVersionedFile', ex);
            return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
        }
    }
}
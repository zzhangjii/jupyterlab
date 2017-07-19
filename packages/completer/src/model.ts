// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  IIterator, IterableOrArrayLike, iter, map, toArray
} from '@phosphor/algorithm';

import {
  JSONExt
} from '@phosphor/coreutils';

import {
  StringExt
} from '@phosphor/algorithm';

import {
  ISignal, Signal
} from '@phosphor/signaling';

import {
  Completer
} from './widget';


/**
 * An implementation of a completer model.
 */
export
class CompleterModel implements Completer.IModel {
  /**
   * A signal emitted when state of the completer menu changes.
   */
  get stateChanged(): ISignal<this, void> {
    return this._stateChanged;
  }

  /**
   * The original completion request details.
   */
  get original(): Completer.ITextState | null {
    return this._original;
  }
  set original(newValue: Completer.ITextState | null) {
    let unchanged = this._original === newValue ||
      this._original && newValue &&
      JSONExt.deepEqual(newValue, this._original);
    if (unchanged) {
      return;
    }

    this._reset();
    this._original = newValue;
    this._stateChanged.emit(void 0);
  }

  /**
   * The current text change details.
   */
  get current(): Completer.ITextState | null {
    return this._current;
  }
  set current(newValue: Completer.ITextState | null) {
    let unchanged = this._current === newValue ||
      this._current && newValue &&
      JSONExt.deepEqual(newValue, this._current);
    if (unchanged) {
      return;
    }

    let original = this._original;

    // Original request must always be set before a text change. If it isn't
    // the model fails silently.
    if (!original) {
      return;
    }

    // Cursor must always be set before a text change. This happens
    // automatically in the completer handler, but since `current` is a public
    // attribute, this defensive check is necessary.
    if (!this._cursor) {
      return;
    }

    let current = this._current = newValue;
    if (!current) {
      this._stateChanged.emit(void 0);
      return;
    }

    const originalLine = original.text.split('\n')[original.line];
    const currentLine = current.text.split('\n')[current.line];

    // If the text change means that the original start point has been preceded,
    // then the completion is no longer valid and should be reset.
    if (currentLine.length < originalLine.length) {
      this.reset(true);
      return;
    }

    const { start, end } = this._cursor;
    // Clip the front of the current line.
    let query = current.text.substring(start);
    // Clip the back of the current line by calculating the end of the original.
    const ending = original.text.substring(end);
    query = query.substring(0, query.lastIndexOf(ending));
    this._query = query;
    this._stateChanged.emit(void 0);
  }


  /**
   * The cursor details that the API has used to return matching options.
   */
  get cursor(): Completer.ICursorSpan | null {
    return this._cursor;
  }
  set cursor(newValue: Completer.ICursorSpan | null) {
    // Original request must always be set before a cursor change. If it isn't
    // the model fails silently.
    if (!this.original) {
      return;
    }
    this._cursor = newValue;
  }

  /**
   * The query against which items are filtered.
   */
  get query(): string {
    return this._query;
  }
  set query(newValue: string) {
    this._query = newValue;
  }

  /**
   * A flag that is true when the model value was modified by a subset match.
   */
  get subsetMatch(): boolean {
    return this._subsetMatch;
  }
  set subsetMatch(newValue: boolean) {
    this._subsetMatch = newValue;
  }

  /**
   * Get whether the model is disposed.
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Dispose of the resources held by the model.
   */
  dispose(): void {
    // Do nothing if already disposed.
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    Signal.clearData(this);
  }

  /**
   * The list of visible items in the completer menu.
   *
   * #### Notes
   * This is a read-only property.
   */
  items(): IIterator<Completer.IItem> {
    return this._filter();
  }

  /**
   * The unfiltered list of all available options in a completer menu.
   */
  options(): IIterator<string> {
    return iter(this._options);
  }

  /**
   * Set the avilable options in the completer menu.
   */
  setOptions(newValue: IterableOrArrayLike<string>) {
    const values = toArray(newValue || []);
    if (JSONExt.deepEqual(values, this._options)) {
      return;
    }
    if (values.length) {
      this._options = values;
      this._subsetMatch = true;
    } else {
      this._options = [];
    }
    this._stateChanged.emit(void 0);
  }

  /**
   * Handle a cursor change.
   */
  handleCursorChange(change: Completer.ITextState): void {
    // If there is no active completion, return.
    if (!this._original) {
      return;
    }

    const { column, line } = change;
    const { original } = this;

    if (!original) {
      return;
    }

    // If a cursor change results in a the cursor being on a different line
    // than the original request, cancel.
    if (line !== original.line) {
      this.reset(true);
      return;
    }

    // If a cursor change results in the cursor being set to a position that
    // precedes the original request, cancel.
    if (column < original.column) {
      this.reset(true);
      return;
    }

    let { cursor, current } = this;
    if (!cursor || !current) {
      return;
    }

    // If a cursor change results in the cursor being set to a position beyond
    // the end of the area that would be affected by completion, cancel.
    const cursorDelta = cursor.end - cursor.start;
    const originalLine = original.text.split('\n')[original.line];
    const currentLine = current.text.split('\n')[current.line];
    const inputDelta = currentLine.length - originalLine.length;
    if (column > original.column + cursorDelta + inputDelta) {
      this.reset(true);
      return;
    }
  }

  /**
   * Handle a text change.
   */
  handleTextChange(change: Completer.ITextState): void {
    // If there is no active completion, return.
    if (!this._original) {
      return;
    }

    // When the completer detects a common subset prefix for all options,
    // it updates the model and sets the model source to that value, but this
    // text change should be ignored.
    if (this._subsetMatch) {
      return;
    }

    const { text, column, line } = change;
    const last = text.split('\n')[line][column - 1];

    // If last character entered is not whitespace, update completion.
    if (last && last.match(/\S/)) {
      this.current = change;
    } else {
      // If final character is whitespace, reset completion.
      this.reset();
    }
  }

  /**
   * Create a resolved patch between the original state and a patch string.
   *
   * @param patch - The patch string to apply to the original value.
   *
   * @returns A patched text change or undefined if original value did not exist.
   */
  createPatch(patch: string): Completer.IPatch | undefined {
    let original = this._original;
    let cursor = this._cursor;

    if (!original || !cursor) {
      return undefined;
    }

    let prefix = original.text.substring(0, cursor.start);
    let suffix = original.text.substring(cursor.end);

    return { offset: (prefix + patch).length, text: prefix + patch + suffix };
  }

  /**
   * Reset the state of the model and emit a state change signal.
   *
   * @param hard - Reset even if a subset match is in progress.
   */
  reset(hard = false) {
    // When the completer detects a common subset prefix for all options,
    // it updates the model and sets the model source to that value, triggering
    // a reset. Unless explicitly a hard reset, this should be ignored.
    if (!hard && this._subsetMatch) {
      return;
    }
    this._subsetMatch = false;
    this._reset();
    this._stateChanged.emit(void 0);
  }

  /**
   * Apply the query to the complete options list to return the matching subset.
   */
  private _filter(): IIterator<Completer.IItem> {
    let options = this._options || [];
    let query = this._query;
    if (!query) {
      return map(options, option => ({ raw: option, text: option }));
    }
    let results: Private.IMatch[] = [];
    for (let option of options) {
      let match = StringExt.matchSumOfSquares(option, query);
      if (match) {
        let marked = StringExt.highlight(option, match.indices, Private.mark);
        results.push({
          raw: option,
          score: match.score,
          text: marked.join('')
        });
      }
    }
    return map(results.sort(Private.scoreCmp), result =>
      ({ text: result.text, raw: result.raw })
    );
  }

  /**
   * Reset the state of the model.
   */
  private _reset(): void {
    this._current = null;
    this._cursor = null;
    this._options = [];
    this._original = null;
    this._query = '';
    this._subsetMatch = false;
  }

  private _current: Completer.ITextState | null = null;
  private _cursor: Completer.ICursorSpan | null = null;
  private _isDisposed = false;
  private _options: string[] = [];
  private _original: Completer.ITextState | null = null;
  private _query = '';
  private _subsetMatch = false;
  private _stateChanged = new Signal<this, void>(this);
}


/**
 * A namespace for completer model private data.
 */
namespace Private {
  /**
   * A filtered completion menu matching result.
   */
  export
  interface IMatch {
    /**
     * The raw text of a completion match.
     */
    raw: string;

    /**
     * A score which indicates the strength of the match.
     *
     * A lower score is better. Zero is the best possible score.
     */
    score: number;

    /**
     * The highlighted text of a completion match.
     */
    text: string;
  }

  /**
   * Mark a highlighted chunk of text.
   */
  export
  function mark(value: string): string {
    return `<mark>${value}</mark>`;
  }

  /**
   * A sort comparison function for item match scores.
   *
   * #### Notes
   * This orders the items first based on score (lower is better), then
   * by locale order of the item text.
   */
  export
  function scoreCmp(a: IMatch, b: IMatch): number {
    let delta = a.score - b.score;
    if (delta !== 0) {
      return delta;
    }
    return a.raw.localeCompare(b.raw);
  }
}

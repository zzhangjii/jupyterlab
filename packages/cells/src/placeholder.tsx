/*-----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/


import {
  h, VirtualNode
} from '@phosphor/virtualdom';

import {
  VDomRenderer
} from '@jupyterlab/apputils';


/**
 * The CSS class added to placeholders.
 */
const PLACEHOLDER_CLASS = 'jp-Placeholder';

/**
 * The CSS classes added to input placeholder prompts.
 */
const INPUT_PROMPT_CLASS = 'jp-Placeholder-prompt jp-InputPrompt';

/**
 * The CSS classes added to output placeholder prompts.
 */
const OUTPUT_PROMPT_CLASS = 'jp-Placeholder-prompt jp-OutputPrompt';

/**
 * The CSS class added to placeholder content.
 */
const CONTENT_CLASS = 'jp-Placeholder-content';

/**
 * The CSS class added to input placeholders.
 */
const INPUT_PLACEHOLDER_CLASS = 'jp-InputPlaceholder';

/**
 * The CSS class added to output placeholders.
 */
const OUTPUT_PLACEHOLDER_CLASS = 'jp-OutputPlaceholder';


/**
 * An abstract base class for placeholders
 *
 * ### Notes
 * A placeholder is the element that is shown when input/output
 * is hidden.
 */
export
abstract class Placeholder extends VDomRenderer<null> {
  /**
   * Construct a new placeholder.
   */
  constructor(callback: (e: Event) => void) {
    super();
    this.addClass(PLACEHOLDER_CLASS);
    this._callback = callback;
  }

  /**
   * Handle the click event.
   */
  protected handleClick(e: Event): void {
    let callback = this._callback;
    callback(e);
  }

  private _callback: (e: Event) => void;
}


/**
 * The input placeholder class.
 */
export
class InputPlaceholder extends Placeholder {
  /**
   * Construct a new input placeholder.
   */
  constructor(callback: (e: Event) => void) {
    super(callback);
    this.addClass(INPUT_PLACEHOLDER_CLASS);
  }

  /**
   * Render the input placeholder using the virtual DOM.
   */
  protected render(): VirtualNode | ReadonlyArray<VirtualNode> {
    return [
        <div className={INPUT_PROMPT_CLASS}>
        </div>,
        <div className={CONTENT_CLASS} onclick={ (e) => this.handleClick(e) }>
          <div className="jp-MoreHorizIcon" />
        </div>
    ]
  }

}


/**
 * The output placeholder class.
 */
export
class OutputPlaceholder extends Placeholder {
  /**
   * Construct a new output placeholder.
   */
  constructor(callback: (e: Event) => void) {
    super(callback);
    this.addClass(OUTPUT_PLACEHOLDER_CLASS);
  }

  /**
   * Render the output placeholder using the virtual DOM.
   */
  protected render(): VirtualNode | ReadonlyArray<VirtualNode> {
    return [
        <div className={OUTPUT_PROMPT_CLASS}>
        </div>,
        <div className={CONTENT_CLASS} onclick={ (e) => this.handleClick(e) }>
          <div className="jp-MoreHorizIcon" />
        </div>
    ]
  }

}

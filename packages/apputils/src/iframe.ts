// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  Widget
} from '@phosphor/widgets';


/**
 * A phosphor widget which wraps an IFrame.
 */
export
class IFrame extends Widget {
  /**
   * Create a new IFrame widget.
   */
  constructor() {
    super({ node: Private.createNode() });
    this.addClass('jp-IFrame');
  }

  /**
   * The url of the IFrame.
   */
  get url(): string {
    return this.node.querySelector('iframe')!.getAttribute('src') || '';
  }
  set url(url: string) {
    this.node.querySelector('iframe')!.setAttribute('src', url);
  }
}


/**
 * A namespace for private data.
 */
namespace Private {
  /**
   * Create the main content node of an iframe widget.
   */
  export
  function createNode(): HTMLElement {
    let node = document.createElement('div');
    let iframe = document.createElement('iframe');
    iframe.style.height = '100%';
    iframe.style.width = '100%';
    node.appendChild(iframe);
    return node;
  }
}

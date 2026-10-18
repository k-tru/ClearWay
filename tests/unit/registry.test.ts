import { afterEach, describe, expect, it } from 'vitest';
import { fixedTotal, isTouched, markFixed, restore, restoreAll, setAttr, setStyle } from '../../src/content/registry';

afterEach(() => {
  restoreAll('contrast');
  restoreAll('links');
  document.body.innerHTML = '';
});

function div(html = '<div></div>'): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

describe('setStyle / restore', () => {
  it('puts back the original inline value and priority', () => {
    const el = div('<div style="color: red !important"></div>');
    setStyle('contrast', el, 'color', 'rgb(0, 0, 0)');
    expect(el.style.getPropertyValue('color')).toBe('rgb(0, 0, 0)');
    expect(isTouched('contrast', el)).toBe(true);

    restore('contrast', el);
    expect(el.style.getPropertyValue('color')).toBe('red');
    expect(el.style.getPropertyPriority('color')).toBe('important');
    expect(isTouched('contrast', el)).toBe(false);
  });

  it('removes a property that was not set before', () => {
    const el = div();
    setStyle('contrast', el, 'color', 'rgb(0, 0, 0)');
    restore('contrast', el);
    expect(el.getAttribute('style')).toBe('');
  });

  it('leaves the value alone if the page changed it after us', () => {
    const el = div();
    setStyle('contrast', el, 'color', 'rgb(0, 0, 0)');
    el.style.setProperty('color', 'blue');
    restore('contrast', el);
    expect(el.style.getPropertyValue('color')).toBe('blue');
  });
});

describe('setAttr / restore', () => {
  it('restores, re-adds and removes attributes', () => {
    const el = div('<div aria-label="Old" title="Keep"></div>');
    setAttr('links', el, 'aria-label', 'New');
    setAttr('links', el, 'title', null);
    setAttr('links', el, 'aria-describedby', 'x');
    expect(el.getAttribute('aria-label')).toBe('New');
    expect(el.hasAttribute('title')).toBe(false);

    restore('links', el);
    expect(el.getAttribute('aria-label')).toBe('Old');
    expect(el.getAttribute('title')).toBe('Keep');
    expect(el.hasAttribute('aria-describedby')).toBe(false);
  });

  it('keeps features separate', () => {
    const el = div();
    setAttr('links', el, 'aria-label', 'Link');
    setStyle('contrast', el, 'color', 'rgb(0, 0, 0)');
    restore('links', el);
    expect(el.hasAttribute('aria-label')).toBe(false);
    expect(el.style.getPropertyValue('color')).toBe('rgb(0, 0, 0)');
  });
});

describe('fixed counts and outlines', () => {
  it('counts connected elements and marks them for the outline', () => {
    const el = div();
    setAttr('links', el, 'aria-label', 'Link');
    markFixed('links', el);
    expect(fixedTotal('links')).toBe(1);
    expect(el.getAttribute('data-clearway')).toBe('links');

    restoreAll('links');
    expect(fixedTotal('links')).toBe(0);
    expect(el.hasAttribute('data-clearway')).toBe(false);
  });

  it('stops counting elements removed from the page', () => {
    const el = div();
    markFixed('links', el);
    el.remove();
    expect(fixedTotal('links')).toBe(0);
  });
});

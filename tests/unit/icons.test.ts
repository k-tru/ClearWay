import { afterEach, describe, expect, it } from 'vitest';
import { buttonName, findButtonName } from '../../src/content/buttons';
import { iconName, isSymbolOnly, tokens } from '../../src/content/icons';

afterEach(() => {
  document.body.innerHTML = '';
});

function el(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

describe('tokens', () => {
  it('splits class names and camelCase', () => {
    expect(tokens('fa-solid fa-magnifying-glass iconSearch')).toEqual(['fa', 'solid', 'fa', 'magnifying', 'glass', 'icon', 'search']);
  });
});

describe('iconName', () => {
  it('names symbols', () => {
    expect(iconName(el('<button>×</button>'), '×')).toBe('Close');
    expect(iconName(el('<button>☰</button>'), '☰')).toBe('Menu');
  });

  it('names icon classes, SVG sprites and image files', () => {
    expect(iconName(el('<button><i class="fa-solid fa-magnifying-glass"></i></button>'), '')).toBe('Search');
    expect(iconName(el('<button><svg><use href="#icon-cart"></use></svg></button>'), '')).toBe('Cart');
    expect(iconName(el('<a href="#"><img src="/img/twitter.svg" alt=""></a>'), '')).toBe('Twitter');
  });

  it('reads direction from arrows', () => {
    expect(iconName(el('<button class="carousel-arrow-right"></button>'), '')).toBe('Next');
    expect(iconName(el('<button><span class="chevron left"></span></button>'), '')).toBe('Previous');
  });

  it('returns null without evidence', () => {
    expect(iconName(el('<button class="btn btn-primary"></button>'), '')).toBeNull();
  });
});

describe('isSymbolOnly', () => {
  it('is true only for bare symbols', () => {
    expect(isSymbolOnly(' ☰ ')).toBe(true);
    expect(isSymbolOnly('Menu')).toBe(false);
  });
});

describe('buttonName', () => {
  it('uses the browser defaults for submit and reset inputs', () => {
    expect(buttonName(el('<input type="submit">'))).toBe('Submit');
    expect(buttonName(el('<input type="reset" value="Clear form">'))).toBe('Clear form');
    expect(buttonName(el('<input type="button">'))).toBe('');
  });
});

describe('findButtonName', () => {
  it('names submit buttons from their form', () => {
    document.body.innerHTML = '<form><input type="search"><button></button></form><form><button></button></form>';
    const [search, plain] = document.querySelectorAll('button');
    expect(findButtonName(search, '')).toBe('Search');
    expect(findButtonName(plain, '')).toBe('Submit');
  });

  it('names toggles from the element they control', () => {
    document.body.innerHTML = '<button aria-controls="nav"></button><nav id="nav" aria-label="Main navigation"></nav>';
    expect(findButtonName(document.querySelector('button')!, '')).toBe('Toggle Main navigation');
  });
});

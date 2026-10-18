import { afterEach, describe, expect, it } from 'vitest';
import { controlName, findLabel, humanise } from '../../src/content/forms';

afterEach(() => {
  document.body.innerHTML = '';
});

function control(html: string, selector = 'input, select, textarea'): HTMLElement {
  document.body.innerHTML = html;
  return document.querySelector<HTMLElement>(selector)!;
}

describe('humanise', () => {
  it('turns field names into words', () => {
    expect(humanise('first_name')).toBe('First name');
    expect(humanise('emailAddress')).toBe('Email address');
    expect(humanise('user[email]')).toBe('Email');
    expect(humanise('dob')).toBe('Date of birth');
    expect(humanise('q')).toBe('Search');
  });

  it('rejects names that say nothing', () => {
    expect(humanise('field_23')).toBe('');
    expect(humanise('txt1')).toBe('');
    expect(humanise(null)).toBe('');
  });
});

describe('controlName', () => {
  it('reads <label for>, aria-label and placeholder', () => {
    expect(controlName(control('<label for="e">Email</label><input id="e">'))).toBe('Email');
    expect(controlName(control('<input aria-label="Phone">'))).toBe('Phone');
    expect(controlName(control('<input placeholder="Search…">'))).toBe('Search…');
    expect(controlName(control('<input>'))).toBe('');
  });
});

describe('findLabel', () => {
  it('uses short text right before a field', () => {
    expect(findLabel(control('<div><span>Email:</span> <input type="text"></div>'))).toBe('Email');
  });

  it('uses text after a checkbox', () => {
    expect(findLabel(control('<div><input type="checkbox"> <span>Send me the newsletter</span></div>'))).toBe('Send me the newsletter');
  });

  it('uses the column header in a table', () => {
    document.body.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Quantity</th></tr></thead>
        <tbody><tr><td><input></td><td><input></td></tr></tbody>
      </table>`;
    const [name, qty] = document.querySelectorAll('input');
    expect(findLabel(name)).toBe('Name');
    expect(findLabel(qty)).toBe('Quantity');
  });

  it('falls back to autocomplete, a select prompt, then the field name', () => {
    expect(findLabel(control('<input autocomplete="shipping given-name">'))).toBe('First name');
    expect(findLabel(control('<select name="hood"><option value="">Select your neighborhood</option><option>North</option></select>'))).toBe(
      'Select your neighborhood',
    );
    expect(findLabel(control('<input name="last_name">'))).toBe('Last name');
  });

  it('uses the legend of a fieldset with one control', () => {
    expect(findLabel(control('<fieldset><legend>Delivery notes</legend><textarea></textarea></fieldset>'))).toBe('Delivery notes');
  });

  it('returns nothing when there are no clues', () => {
    expect(findLabel(control('<input name="f_23">'))).toBe('');
  });
});

import { createSignal, For } from 'solid-js';
import type { SimCity } from './data';
import type { Division, Draw } from './model';
import { divisionPrice } from './EventDetails';

const CHOICES: { key: Division; label: string }[] = [
  { key: 'junior', label: 'Junior' },
  { key: 'senior', label: 'Senior' },
  { key: 'masters', label: 'Masters' }
];

/**
 * The registration step: pick a division and confirm. The competitor
 * agreement comes already accepted.
 */
export function RegisterForm(props: {
  city: SimCity;
  draw: Draw;
  onSubmit: (division: Division) => void;
  onCancel: () => void;
}) {
  const [division, setDivision] = createSignal<Division>('masters');

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    props.onSubmit(division());
  };

  return (
    <form class='regsim-form' onSubmit={submit}>
      <h1>Register: {props.city.city} Regional Championships</h1>
      <fieldset>
        <legend>Division</legend>
        <For each={CHOICES}>
          {choice => (
            <label class='regsim-choice'>
              <input
                type='radio'
                name='division'
                value={choice.key}
                checked={division() === choice.key}
                onChange={() => setDivision(choice.key)}
              />
              <span>{choice.label}</span>
              <span class='regsim-muted'>{divisionPrice(props.city, choice.key)}</span>
            </label>
          )}
        </For>
      </fieldset>
      <label class='regsim-choice'>
        <input type='checkbox' checked disabled />
        <span>I have read and accept the competitor agreement.</span>
      </label>
      <div class='regsim-actions'>
        <button type='submit' class='btn btn-primary'>
          Register
        </button>
        <button type='button' class='btn btn-ghost' onClick={() => props.onCancel()}>
          Back
        </button>
      </div>
      <p class='regsim-code'>{props.draw.code}</p>
    </form>
  );
}

import { createSignal, For } from 'solid-js';
import type { SimCity } from './data';
import type { Division, Draw } from './model';
import { divisionPrice, EventTitle } from './EventDetails';

const CHOICES: { key: Division; label: string }[] = [
  { key: 'junior', label: 'Junior division' },
  { key: 'senior', label: 'Senior division' },
  { key: 'masters', label: 'Masters division' }
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
    <form onSubmit={submit}>
      <EventTitle city={props.city} draw={props.draw} />
      <section class='regsim-card regsim-details'>
        <div class='regsim-card-head'>
          <h2>Registration</h2>
        </div>
        <div class='regsim-card-body'>
          <fieldset class='regsim-fieldset'>
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
                  <span>
                    {choice.label}: {divisionPrice(props.city, choice.key)}
                  </span>
                </label>
              )}
            </For>
          </fieldset>
          <label class='regsim-choice'>
            <input type='checkbox' checked disabled />
            <span>I have read and accept the competitor agreement.</span>
          </label>
        </div>
      </section>
      <div class='regsim-go'>
        <button type='submit' class='regsim-btn regsim-btn-go'>
          Register
        </button>
        <button type='button' class='regsim-btn regsim-btn-link' onClick={() => props.onCancel()}>
          Back to tournament
        </button>
      </div>
    </form>
  );
}

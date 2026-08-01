import { Draftroll, dice } from '@draftroll/sdk/browser';

const draftroll = new Draftroll();
draftroll.engine.registerDie({
  id: 'weather',
  renderAs: 'd6',
  faces: [
    { result: 'sun', value: 2, label: 'Sun' },
    { result: 'cloud', value: 0, label: 'Cloud' },
    { result: 'rain', value: -1, label: 'Rain' },
    { result: 'wind', value: 1, label: 'Wind' },
    { result: 'storm', value: -2, label: 'Storm' },
    { result: 'rainbow', value: 3, label: 'Rainbow' },
  ],
});

const result = draftroll.rollDice({ dice: [dice.custom('weather', 'weather-result')] });
console.log(result.result.dice[0].faceLabel, result.total);

import { strict as assert } from 'node:assert';
import Marshal from './Marshal.js';
import { BigNumber } from 'bignumber.js';
import mnemonist from 'mnemonist';

// NB: separate marshal and unmarshal parameters to simulate a context barrier
function roundtripsToBe(marshal: Marshal, unmarshal: Marshal, value: unknown) {
  expect(unmarshal.unmarshal(marshal.marshal(value))).toBe(value);
}

function roundtripsToEqual(
  marshal: Marshal,
  unmarshal: Marshal,
  value: unknown,
) {
  expect(unmarshal.unmarshal(marshal.marshal(value))).toEqual(value);
}

test('primitives', () => {
  const marshal = new Marshal();
  const unmarshal = new Marshal();
  roundtripsToBe(marshal, unmarshal, undefined);
  roundtripsToBe(marshal, unmarshal, null);
  roundtripsToBe(marshal, unmarshal, true);
  roundtripsToBe(marshal, unmarshal, false);
  roundtripsToBe(marshal, unmarshal, 1);
  // roundtripsToBe(marshal, unmarshal, 1258273897234238723n);
  roundtripsToBe(marshal, unmarshal, 'hello');
  roundtripsToEqual(marshal, unmarshal, new Date(100));
});

test('references', () => {
  const hello = Symbol('hello');
  const world = Symbol('world');

  function foo(a: number): number {
    return a + a;
  }

  function bar(b: number): number {
    return b * b;
  }

  const marshal = new Marshal({
    symbols: [hello, world],
    functions: [foo, bar],
  });

  const unmarshal = new Marshal({
    symbols: [hello, world],
    functions: [foo, bar],
  });

  roundtripsToBe(marshal, unmarshal, hello);
  roundtripsToBe(marshal, unmarshal, world);
  roundtripsToBe(marshal, unmarshal, foo);
  roundtripsToBe(marshal, unmarshal, bar);
});

test('POJOs do not roundtrip reference-equal, but do roundtrip value-equal', () => {
  const marshal = new Marshal();
  const unmarshal = new Marshal();
  const pojo = {
    hello: 'world',
    aloha: 333,
  };
  const ojop = unmarshal.unmarshal(marshal.marshal(pojo));
  expect(pojo).not.toBe(ojop);
  expect(pojo).toEqual(ojop);
});

test('reference equality', () => {
  const marshal = new Marshal();
  const unmarshal = new Marshal();
  const inner = { hello: 'world' };
  const outer = [inner, inner, inner, inner];
  const retval = unmarshal.unmarshal(marshal.marshal(outer)) as typeof outer;
  expect(retval[0]).toBe(retval[1]);
  expect(retval[1]).toBe(retval[2]);
  expect(retval[2]).toBe(retval[3]);
});

class Foo {
  constructor(public hello: string, private world: string) {}
  sayHello(): string {
    return this.hello + ' ' + this.world;
  }
}

class Bar extends Foo {
  sayHello(): string {
    return 'No greetings for you';
  }
}

test('classes', () => {
  const marshal = new Marshal({ prototypes: [Foo, Bar] });
  const unmarshal = new Marshal({ prototypes: [Foo, Bar] });
  const foo = new Foo('hola', 'mundi');
  const bar = new Bar('hullo', 'guvna');
  const foo2 = unmarshal.unmarshal(marshal.marshal(foo)) as Foo;
  const bar2 = unmarshal.unmarshal(marshal.marshal(bar)) as Bar;
  expect(foo).not.toBe(foo2); // references not preserved across context (obviously)
  expect(bar).not.toBe(bar2);
  expect(foo.sayHello()).toEqual('hola mundi');
  expect(bar.sayHello()).toEqual('No greetings for you');
});

class Baz {
  constructor(public foos: Foo[], public bar: Bar) {}
}

test('nested complex types', () => {
  const marshal = new Marshal({ prototypes: [Foo, Bar, Baz] });
  const unmarshal = new Marshal({ prototypes: [Foo, Bar, Baz] });
  const foo = new Foo('hola', 'mundi');
  const bar = new Bar('hullo', 'guvna');
  const baz = new Baz([foo, foo], bar);
  const bazout = unmarshal.unmarshal(marshal.marshal(baz)) as Baz;
  expect(baz).toEqual(bazout);
  expect(baz.foos[0]).toBeInstanceOf(Foo);
  expect(baz.foos[1]).toBeInstanceOf(Foo);
  expect(baz.foos[0].sayHello()).toEqual('hola mundi');
  expect(baz.bar).toBeInstanceOf(Bar);
  expect(baz.bar.sayHello()).toEqual('No greetings for you');
});

test('built-in objects', () => {
  const marshal = new Marshal();
  const unmarshal = new Marshal();
  roundtripsToEqual(marshal, unmarshal, new Error('an error'));
  roundtripsToEqual(
    marshal,
    unmarshal,
    new Map<any, any>([
      [1, 2],
      [3, 'world'],
      [new Date(), 'haha'],
    ]),
  );
  roundtripsToEqual(marshal, unmarshal, new Set([1, 2, 3]));
});

test('property attributes', () => {
  const marshal = new Marshal();
  const unmarshal = new Marshal();
  const obj = { trip: undefined };
  Object.defineProperty(obj, 'hello', {
    value: 'world',
    enumerable: true,
    writable: false,
  });
  const objout = unmarshal.unmarshal(marshal.marshal(obj)) as { hello: string };
  expect(obj).toEqual(objout);
  expect(() => {
    objout.hello = 'something else';
  }).toThrow();
});

test('accessors', () => {
  const obj = {
    hello: 'world',
    get hi() {
      return 'hi ' + this.hello;
    },
  };
  const f = Object.getOwnPropertyDescriptor(obj, 'hi')?.get;
  assert(f !== undefined);
  const functions = [f];
  const marshal = new Marshal({ functions });
  const unmarshal = new Marshal({ functions });
  const objout = unmarshal.unmarshal(marshal.marshal(obj)) as typeof obj;
  expect(obj).toEqual(objout);
  expect(obj.hi).toEqual(objout.hi);
});

test('BigNumber', () => {
  const marshal = new Marshal({ prototypes: [BigNumber] });
  const unmarshal = new Marshal({ prototypes: [BigNumber] });
  const bn = new BigNumber('12381241284712831283213123123123');
  roundtripsToEqual(marshal, unmarshal, bn);
});

test('DefaultMap', () => {
  // NB: mnemonist.DefaultMap doesn't allow access to its [.factory], so we have
  // to define it outside.  This isn't ideal, and the user has to know that this
  // needs to be included in [functions], but at least it's possible.
  const f = (key: string) => key.length;
  const x = new mnemonist.DefaultMap<string, number>(f);
  const marshal = new Marshal({
    prototypes: [mnemonist.DefaultMap],
    functions: [f],
  });

  // NB: just to prove that the functions don't have to be literally the same,
  // only the same definition
  const g = (key: string) => key.length;
  const unmarshal = new Marshal({
    prototypes: [mnemonist.DefaultMap],
    functions: [g],
  });

  x.set('hello', 1337);
  x.get('world'); // should be set to 5 via default factory
  expect([...x.entries()]).toEqual([
    ['hello', 1337],
    ['world', 5],
  ]);

  const xcopy = unmarshal.unmarshal(marshal.marshal(x)) as typeof x;
  expect([...x.entries()]).toEqual([...xcopy.entries()]);
  expect(xcopy.get('same factory')).toEqual(12);
});

import { FoodCatalogItemSchema, type FoodCatalogItem, type ItemRarity } from "./schema";

export interface FoodLocalizedCopy {
  readonly en: Readonly<{ name: string; description: string }>;
  readonly de: Readonly<{ name: string; description: string }>;
}

type FoodRow = readonly [
  id: string,
  enName: string,
  enDescription: string,
  deName: string,
  deDescription: string,
  price: number,
  rarity: ItemRarity,
  level: number,
  color: number,
  hunger: number,
  xp: number,
];

const foodRows: readonly FoodRow[] = [
  ["crisp-carrot", "Crisp Carrot", "A sunny market carrot with a loud, happy crunch.", "Knackige Karotte", "Eine sonnige Marktkarotte, die bei jedem Bissen fröhlich knackt.", 4, "everyday", 1, 0xf28b32, 10, 3],
  ["apple-smile-slices", "Apple Smile Slices", "Sweet red slices arranged like a tiny rabbit smile.", "Apfellächel-Schnitze", "Süße rote Apfelschnitze, die wie ein kleines Hasenlächeln liegen.", 5, "everyday", 1, 0xdb5b55, 11, 3],
  ["blueberry-button-cup", "Blueberry Button Cup", "A paper cup full of juicy blueberry buttons.", "Blaubeerknopf-Becher", "Ein kleiner Becher voller saftiger Blaubeerknöpfe.", 6, "everyday", 1, 0x6575bd, 12, 4],
  ["garden-pea-pops", "Garden Pea Pops", "Fresh peas that pop softly with every nibble.", "Gartenerbsen-Hüpfer", "Frische Erbsen, die beim Knabbern sanft aufploppen.", 6, "everyday", 1, 0x76ad5f, 13, 4],
  ["pear-belly-wedges", "Pear Belly Wedges", "Gentle green pear wedges for a comfortably full belly.", "Birnenbauch-Spalten", "Milde grüne Birnenspalten für einen wohlig vollen Bauch.", 7, "everyday", 1, 0xb2c96d, 14, 4],
  ["strawberry-clover-bowl", "Strawberry Clover Bowl", "Strawberry halves tucked around tender clover leaves.", "Erdbeer-Kleeblatt-Schale", "Halbe Erdbeeren liegen rund um zarte Kleeblätter.", 8, "everyday", 1, 0xef6b70, 15, 5],
  ["pumpkin-pillow-bites", "Pumpkin Pillow Bites", "Soft baked pumpkin squares with pillowy centers.", "Kürbiskissen-Happen", "Weich gebackene Kürbisquadrate mit luftigem Kern.", 9, "everyday", 1, 0xe99a45, 17, 5],
  ["banana-moon-coins", "Banana Moon Coins", "Round banana moons dusted with oat sparkle.", "Bananenmond-Taler", "Runde Bananenmonde mit einem Hauch Haferglitzer.", 9, "everyday", 1, 0xf2d565, 17, 6],
  ["tomato-toast-hearts", "Tomato Toast Hearts", "Warm tomato toast cut into two friendly hearts.", "Tomatentoast-Herzen", "Warmer Tomatentoast, in zwei freundliche Herzen geschnitten.", 10, "special", 2, 0xd95e4f, 19, 7],
  ["meadow-herb-sandwich", "Meadow Herb Sandwich", "A thick little sandwich layered with fragrant garden herbs.", "Wiesenkräuter-Sandwich", "Ein dickes kleines Sandwich mit duftenden Gartenkräutern.", 11, "special", 2, 0x85aa65, 21, 7],
  ["sunny-corn-muffin", "Sunny Corn Muffin", "A golden corn muffin baked with a sunny top.", "Sonnenmais-Muffin", "Ein goldener Maismuffin mit sonnig gebackener Haube.", 12, "special", 2, 0xeabd54, 22, 8],
  ["watermelon-picnic-star", "Watermelon Picnic Star", "A cool watermelon slice shaped into a picnic star.", "Melonen-Picknickstern", "Eine kühle Wassermelonenscheibe in fröhlicher Sternform.", 12, "special", 2, 0xe46f71, 23, 8],
  ["cinnamon-pancake-stack", "Cinnamon Pancake Stack", "Three fluffy pancakes with a soft cinnamon swirl.", "Zimtpfannkuchen-Stapel", "Drei luftige Pfannkuchen mit einem feinen Zimtwirbel.", 14, "special", 2, 0xc99159, 26, 10],
  ["rainbow-veggie-pie", "Rainbow Veggie Pie", "A bright vegetable pie with every color in the garden.", "Regenbogen-Gemüsekuchen", "Ein bunter Gemüsekuchen in allen Farben des Gartens.", 16, "treasured", 3, 0xcb7f68, 29, 12],
  ["berry-cloud-parfait", "Berry Cloud Parfait", "Creamy oat clouds layered with mixed meadow berries.", "Beerenwolken-Parfait", "Cremige Haferwolken, geschichtet mit gemischten Wiesenbeeren.", 17, "treasured", 3, 0xc182ad, 31, 14],
  ["harvest-sharing-platter", "Harvest Sharing Platter", "A generous harvest plate made for an extra-cozy meal.", "Große Ernteplatte", "Eine großzügige Ernteplatte für eine besonders gemütliche Mahlzeit.", 18, "treasured", 3, 0xdc9855, 35, 16],
  ["hazelnut-nougat-spread", "Hazelnut Nougat Spread", "A silky cocoa-hazelnut spread in an original moon-label jar.", "Haselnuss-Nougat-Creme", "Eine seidige Kakao-Haselnuss-Creme im Glas mit eigenem Mondetikett.", 19, "special", 3, 0x8c573b, 24, 9],
  ["cloudberry-layer-cake", "Cloudberry Layer Cake", "Soft vanilla layers with bright cloudberry ribbons.", "Moltebeer-Schichttorte", "Weiche Vanilleschichten mit leuchtenden Moltebeerbändern.", 22, "special", 3, 0xe7a76f, 27, 10],
  ["lemon-daisy-cake", "Lemon Daisy Cake", "A sunny lemon cake topped with tiny sugar daisies.", "Zitronen-Gänseblümchentorte", "Eine sonnige Zitronentorte mit kleinen Zuckergänseblümchen.", 24, "special", 4, 0xf0d86b, 28, 11],
  ["cocoa-acorn-cake", "Cocoa Acorn Cake", "A cocoa sponge shaped like a plump woodland acorn.", "Kakao-Eicheltorte", "Ein lockerer Kakaokuchen in Form einer runden Waldeichel.", 25, "treasured", 4, 0x86543e, 30, 12],
  ["oat-honey-biscuit", "Oat Honey Biscuit", "A broad oat biscuit brushed with meadow honey.", "Hafer-Honig-Keks", "Ein großer Haferkeks, bestrichen mit mildem Wiesenhonig.", 13, "everyday", 2, 0xd8ae63, 20, 7],
  ["raspberry-swirl-roll", "Raspberry Swirl Roll", "A springy sponge roll curled around raspberry cream.", "Himbeerwirbel-Rolle", "Eine lockere Biskuitrolle mit einer Spirale aus Himbeercreme.", 21, "special", 4, 0xd66d83, 27, 11],
  ["vegetable-soup-cup", "Vegetable Soup Cup", "A warm cup of tiny vegetables in a mellow garden broth.", "Gemüsesuppen-Becher", "Ein warmer Becher mit feinem Gemüse in milder Gartenbrühe.", 15, "everyday", 3, 0xc67b48, 25, 8],
  ["cheesy-herb-scone", "Cheesy Herb Scone", "A crumbly golden scone with cheese and fresh herbs.", "Käse-Kräuter-Scone", "Ein mürber goldener Scone mit Käse und frischen Kräutern.", 18, "special", 3, 0xd3a951, 26, 9],
  ["mango-sun-pudding", "Mango Sun Pudding", "A wobbling mango pudding with a bright citrus center.", "Mango-Sonnenpudding", "Ein wackeliger Mangopudding mit einem hellen Zitruskern.", 23, "special", 4, 0xf2b84e, 29, 12],
  ["cherry-almond-tart", "Cherry Almond Tart", "A crisp almond tart dotted with juicy garden cherries.", "Kirsch-Mandel-Tarte", "Eine knusprige Mandeltarte mit saftigen Gartenkirschen.", 27, "treasured", 5, 0xb94f62, 32, 14],
  ["cucumber-clover-sandwich", "Cucumber Clover Sandwich", "Cool cucumber ribbons and clover greens on soft bread.", "Gurken-Klee-Sandwich", "Kühle Gurkenbänder und Kleegrün auf weichem Brot.", 16, "everyday", 3, 0x8ebc76, 24, 8],
  ["roasted-root-bowl", "Roasted Root Bowl", "Caramelized garden roots gathered into a hearty bowl.", "Ofenwurzel-Schale", "Karamellisiertes Gartengemüse in einer herzhaften Schale.", 28, "treasured", 5, 0xb76e48, 34, 15],
  ["vanilla-moon-custard", "Vanilla Moon Custard", "Velvety vanilla custard crowned with a biscuit moon.", "Vanillemond-Creme", "Samtige Vanillecreme mit einem knusprigen Keks-Mond.", 25, "special", 5, 0xead9a4, 30, 13],
  ["celebration-carrot-cake", "Celebration Carrot Cake", "A tall carrot cake made for sharing after a grand adventure.", "Festliche Karottentorte", "Eine hohe Karottentorte zum Teilen nach einem großen Abenteuer.", 34, "treasured", 6, 0xd98b51, 35, 18],
];

export const FOOD_CATALOG: readonly FoodCatalogItem[] = Object.freeze(
  foodRows.map(([id, name, description, , , price, rarity, levelRequired, color, hunger, xp]) =>
    FoodCatalogItemSchema.parse({
      id,
      name,
      description,
      price,
      rarity,
      levelRequired,
      availability: "always",
      display: { fixture: "shelf", color },
      kind: "food",
      hunger,
      xp,
      stackable: true,
    })),
);

export const FOOD_LOCALIZED_COPY: Readonly<Record<string, FoodLocalizedCopy>> = Object.freeze(
  Object.fromEntries(foodRows.map(([id, enName, enDescription, deName, deDescription]) => [
    id,
    Object.freeze({
      en: Object.freeze({ name: enName, description: enDescription }),
      de: Object.freeze({ name: deName, description: deDescription }),
    }),
  ])),
);

-- Fictional relational seed data for the Sonora chatbot benchmark.
-- All names, products, customers, locations, orders, and support cases are invented.
-- Monetary values are in dollars, without a country-specific currency code.

PRAGMA foreign_keys = ON;

CREATE TABLE store_locations (
    location_id INTEGER PRIMARY KEY,
    location_name TEXT NOT NULL UNIQUE,
    city TEXT NOT NULL,
    region TEXT NOT NULL,
    location_type TEXT NOT NULL CHECK (location_type IN ('store', 'distribution_center'))
);

CREATE TABLE categories (
    category_id INTEGER PRIMARY KEY,
    category_name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL
);

CREATE TABLE products (
    product_id INTEGER PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    category_id INTEGER NOT NULL REFERENCES categories(category_id),
    product_name TEXT NOT NULL,
    brand TEXT NOT NULL,
    description TEXT NOT NULL,
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
    product_status TEXT NOT NULL CHECK (product_status IN ('active', 'discontinued')),
    specifications TEXT NOT NULL
);

CREATE TABLE inventory (
    location_id INTEGER NOT NULL REFERENCES store_locations(location_id),
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    quantity_on_hand INTEGER NOT NULL CHECK (quantity_on_hand >= 0),
    quantity_reserved INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
    PRIMARY KEY (location_id, product_id),
    CHECK (quantity_reserved <= quantity_on_hand)
);

CREATE TABLE promotions (
    promotion_id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    promotion_name TEXT NOT NULL,
    discount_percent NUMERIC NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
    starts_on TEXT NOT NULL,
    ends_on TEXT NOT NULL,
    is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
    CHECK (starts_on <= ends_on)
);

CREATE TABLE customers (
    customer_id INTEGER PRIMARY KEY,
    customer_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    home_city TEXT NOT NULL,
    home_region TEXT NOT NULL,
    account_status TEXT NOT NULL CHECK (account_status IN ('active', 'closed'))
);

CREATE TABLE orders (
    order_id TEXT PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
    order_date TEXT NOT NULL,
    order_status TEXT NOT NULL CHECK (
        order_status IN ('awaiting_payment', 'processing', 'ready_for_pickup', 'in_transit', 'delivered', 'cancelled')
    ),
    payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'paid', 'refunded')),
    payment_method TEXT NOT NULL CHECK (
        payment_method IN ('sonora_transfer', 'card_installments', 'bank_slip')
    ),
    sales_channel TEXT NOT NULL CHECK (sales_channel IN ('online', 'in_store')),
    fulfillment_location_id INTEGER NOT NULL REFERENCES store_locations(location_id),
    fulfillment_method TEXT NOT NULL CHECK (fulfillment_method IN ('delivery', 'pickup')),
    tracking_code TEXT UNIQUE,
    estimated_delivery TEXT,
    subtotal NUMERIC NOT NULL CHECK (subtotal >= 0),
    discount_total NUMERIC NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
    shipping_fee NUMERIC NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
    order_total NUMERIC NOT NULL CHECK (order_total >= 0),
    notes TEXT NOT NULL DEFAULT '',
    CHECK (order_total = subtotal - discount_total + shipping_fee),
    CHECK ((fulfillment_method = 'pickup' AND shipping_fee = 0) OR fulfillment_method = 'delivery')
);

CREATE TABLE order_items (
    order_item_id INTEGER PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(order_id),
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_at_purchase NUMERIC NOT NULL CHECK (unit_price_at_purchase >= 0),
    line_subtotal NUMERIC NOT NULL CHECK (line_subtotal >= 0),
    discount_amount NUMERIC NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    line_total NUMERIC NOT NULL CHECK (line_total >= 0),
    CHECK (line_subtotal = quantity * unit_price_at_purchase),
    CHECK (line_total = line_subtotal - discount_amount)
);

CREATE TABLE service_cases (
    case_id TEXT PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
    order_id TEXT REFERENCES orders(order_id),
    opened_on TEXT NOT NULL,
    case_type TEXT NOT NULL CHECK (
        case_type IN ('delivery_question', 'product_support', 'payment_question', 'return_request')
    ),
    case_status TEXT NOT NULL CHECK (case_status IN ('open', 'waiting_for_customer', 'resolved')),
    summary TEXT NOT NULL,
    resolution TEXT NOT NULL DEFAULT ''
);

INSERT INTO store_locations (location_id, location_name, city, region, location_type) VALUES
    (1, 'Sonora Lyravale Store', 'Lyravale', 'Bellwether', 'store'),
    (2, 'Central Distribution Hall', 'Lyravale', 'Bellwether', 'distribution_center'),
    (3, 'Ashmere Pickup Studio', 'Ashmere', 'Northfen', 'store'),
    (4, 'Thornfield Service Counter', 'Thornfield', 'Greymarch', 'store'),
    (5, 'Silvermere Forwarding Depot', 'Silvermere', 'Westreach', 'distribution_center');

INSERT INTO categories (category_id, category_name, description) VALUES
    (1, 'Guitars', 'Acoustic and electric guitars for practice, performance, and recording.'),
    (2, 'Bass Guitars', 'Electric basses and related instruments for rhythm sections.'),
    (3, 'Drums and Percussion', 'Acoustic and electronic drum kits and percussion instruments.'),
    (4, 'Keyboards and Pianos', 'Digital pianos, stage keyboards, and portable instruments.'),
    (5, 'Audio Equipment', 'Microphones, audio interfaces, monitors, and recording tools.'),
    (6, 'Cases and Stands', 'Protective cases and stands for instruments and equipment.'),
    (7, 'Cables and Accessories', 'Cables and small accessories for instruments and audio equipment.'),
    (8, 'Wind Instruments', 'Woodwind instruments and maintenance accessories.'),
    (9, 'Pedals and Power', 'Signal-shaping pedals and power accessories for musicians.');

INSERT INTO products (product_id, sku, category_id, product_name, brand, description, unit_price, product_status, specifications) VALUES
    (1001, 'SON-GTR-061', 1, 'Student Acoustic Guitar', 'Morrowfield', 'A comfortable six-string guitar for lessons and everyday practice.', 249.00, 'active', 'Six steel strings; spruce-pattern top; satin finish; natural color.'),
    (1002, 'SON-GTR-204', 1, 'Stage Electric Guitar', 'Cinderline', 'A versatile electric guitar with a balanced sound for rehearsal and live sets.', 489.00, 'active', 'Six strings; two humbucking pickups; fixed bridge; midnight blue.'),
    (1003, 'SON-BAS-104', 2, 'Four-String Bass Guitar', 'Northmere', 'A dependable bass for practice, recording, and small venues.', 379.00, 'active', 'Four strings; passive pickups; 34-inch scale; walnut finish.'),
    (1004, 'SON-KEY-088', 4, 'Digital Piano 88', 'Sonora', 'A full-size digital piano with weighted keys for home practice and lessons.', 699.00, 'active', '88 weighted keys; three pedal inputs; headphone output; black finish.'),
    (1005, 'SON-KEY-061', 4, 'Portable Keyboard 61', 'Valecrest', 'A lightweight keyboard with built-in speakers for beginners and travel.', 229.00, 'active', '61 touch-sensitive keys; built-in speakers; sustain input; graphite finish.'),
    (1006, 'SON-DRM-220', 3, 'Electronic Drum Kit', 'Morrowfield', 'A compact electronic kit with quiet practice pads and a headphone output.', 579.00, 'active', 'Five pads; three cymbal pads; headphone output; foldable rack.'),
    (1007, 'SON-AUD-210', 5, 'Studio Monitor Pair', 'Bracken Audio', 'A matched pair of powered monitors for home studios and editing desks.', 319.00, 'active', 'Two monitors; 5-inch drivers; balanced inputs; black finish.'),
    (1008, 'SON-AUD-014', 5, 'USB Audio Interface', 'Sonora', 'A two-input interface for recording instruments and microphones.', 149.00, 'active', 'Two combo inputs; USB connection; 48V phantom power; two outputs.'),
    (1009, 'SON-MIC-058', 5, 'Dynamic Vocal Microphone', 'Cinderline', 'A rugged microphone for vocals, announcements, and rehearsal rooms.', 89.00, 'active', 'Cardioid pickup; wired; XLR connector; includes clip and pouch.'),
    (1010, 'SON-MIC-179', 5, 'Studio Condenser Microphone', 'Bracken Audio', 'A condenser microphone for detailed voice and instrument recording.', 179.00, 'active', 'Cardioid pickup; requires phantom power; shock mount included.'),
    (1011, 'SON-CASE-059', 6, 'Padded Guitar Case', 'Valecrest', 'A padded soft case with storage pockets for standard-size guitars.', 59.00, 'active', 'Water-resistant fabric; shoulder straps; fits most standard guitars.'),
    (1012, 'SON-CAB-003', 7, 'Instrument Cable 3 m', 'Sonora', 'A flexible shielded cable for instruments and amplifiers.', 19.00, 'active', 'Three meters; quarter-inch connectors; straight ends.'),
    (1013, 'SON-STD-020', 6, 'Foldable Keyboard Stand', 'Northmere', 'A discontinued stand model; remaining inventory is available while supplies last.', 39.00, 'discontinued', 'Steel frame; adjustable height; folding design.'),
    (1014, 'SON-PER-012', 3, 'Practice Pad', 'Morrowfield', 'A quiet rebound pad for rudiment practice at home or backstage.', 29.00, 'active', 'Eight-inch surface; non-slip base; drumstick compatible.'),
    (1015, 'SON-UKU-021', 1, 'Concert Ukulele', 'Fablewood', 'A compact four-string instrument with a warm tone for casual playing and lessons.', 119.00, 'active', 'Concert body; four nylon strings; geared tuners; honey finish.'),
    (1016, 'SON-BAS-205', 2, 'Five-String Bass Guitar', 'Northmere', 'A five-string bass with an extended low range for stage and studio work.', 429.00, 'active', 'Five strings; active and passive modes; 34-inch scale; charcoal finish.'),
    (1017, 'SON-DRM-031', 3, 'Electronic Percussion Pad', 'Morrowfield', 'A portable pad with built-in sounds for practice, rehearsal, and small performances.', 159.00, 'active', 'Eight velocity-sensitive zones; headphone output; USB MIDI.'),
    (1018, 'SON-KEY-049', 4, 'MIDI Controller 49', 'Valecrest', 'A compact controller for composing and controlling music software.', 139.00, 'active', '49 velocity-sensitive keys; pitch and modulation wheels; USB connection.'),
    (1019, 'SON-AUD-110', 5, 'Closed-Back Studio Headphones', 'Bracken Audio', 'Closed-back headphones for monitoring during recording and editing.', 109.00, 'active', 'Over-ear design; detachable cable; 32-ohm impedance.'),
    (1020, 'SON-STD-012', 6, 'Short Boom Microphone Stand', 'Tidemark Works', 'A compact adjustable stand for desks, small stages, and podcast setups.', 34.00, 'active', 'Weighted base; short boom arm; folding joints.'),
    (1021, 'SON-CAB-006', 7, 'Shielded Patch Cable 6 m', 'Sonora', 'A longer shielded cable for connecting instruments across rehearsal spaces.', 24.00, 'active', 'Six meters; quarter-inch connectors; braided outer jacket.'),
    (1022, 'SON-PED-044', 9, 'Chromatic Pedal Tuner', 'Cinderline', 'A compact tuner pedal with a clear display for stage use.', 49.00, 'active', 'True bypass; chromatic tuning; metal enclosure; 9V power.'),
    (1023, 'SON-AUD-399', 5, 'Portable PA Speaker', 'Bracken Audio', 'A portable powered speaker for rehearsals, small events, and announcements.', 399.00, 'active', '10-inch driver; two inputs; Bluetooth audio; carry handle.'),
    (1024, 'SON-WND-189', 8, 'Student Clarinet Outfit', 'Fablewood', 'A beginner-friendly clarinet outfit supplied with a case and basic care kit.', 189.00, 'active', 'Key of B-flat; resin body; adjustable thumb rest; case included.');

INSERT INTO inventory (location_id, product_id, quantity_on_hand, quantity_reserved) VALUES
    (1, 1001, 4, 1), (2, 1001, 18, 2),
    (1, 1002, 2, 0), (2, 1002, 9, 1),
    (1, 1003, 1, 0), (2, 1003, 7, 0),
    (1, 1004, 1, 0), (2, 1004, 5, 1),
    (1, 1005, 3, 0), (2, 1005, 12, 0),
    (1, 1006, 0, 0), (2, 1006, 4, 0),
    (1, 1007, 2, 0), (2, 1007, 8, 1),
    (1, 1008, 3, 1), (2, 1008, 11, 1),
    (1, 1009, 6, 0), (2, 1009, 24, 0),
    (1, 1010, 2, 0), (2, 1010, 10, 0),
    (1, 1011, 5, 0), (2, 1011, 20, 0),
    (1, 1012, 16, 2), (2, 1012, 60, 4),
    (1, 1013, 2, 0), (2, 1013, 10, 0),
    (1, 1014, 8, 0), (2, 1014, 30, 0),
    (3, 1001, 2, 0), (3, 1002, 1, 0), (3, 1004, 2, 1),
    (3, 1005, 4, 0), (3, 1008, 1, 0), (3, 1009, 3, 0), (3, 1016, 1, 0),
    (3, 1011, 2, 0), (3, 1012, 8, 0), (3, 1013, 1, 0), (3, 1014, 2, 0),
    (4, 1001, 1, 0), (4, 1003, 2, 0), (4, 1005, 1, 0),
    (4, 1008, 2, 0), (4, 1009, 2, 0), (4, 1010, 1, 0),
    (4, 1011, 3, 0), (4, 1012, 12, 1), (4, 1013, 1, 0), (4, 1014, 4, 0),
    (5, 1001, 6, 0), (5, 1002, 4, 1), (5, 1003, 3, 0),
    (5, 1004, 2, 0), (5, 1005, 5, 0), (5, 1006, 2, 0),
    (5, 1007, 5, 0), (5, 1008, 4, 0), (5, 1009, 8, 0),
    (5, 1010, 3, 0), (5, 1011, 7, 0), (5, 1012, 24, 1),
    (5, 1013, 3, 0), (5, 1014, 10, 0),
    (1, 1015, 1, 0), (1, 1018, 1, 0), (1, 1019, 2, 0),
    (1, 1020, 1, 0), (1, 1021, 10, 0), (1, 1022, 1, 0), (1, 1024, 1, 0),
    (2, 1015, 8, 1), (2, 1016, 4, 0), (2, 1017, 3, 0),
    (2, 1018, 5, 0), (2, 1019, 12, 0), (2, 1020, 8, 0),
    (2, 1021, 30, 2), (2, 1022, 8, 0), (2, 1023, 4, 0), (2, 1024, 6, 0),
    (3, 1015, 3, 0), (3, 1018, 2, 0), (3, 1019, 2, 0),
    (3, 1020, 1, 0), (3, 1021, 8, 0), (3, 1022, 2, 0),
    (4, 1015, 1, 0), (4, 1016, 2, 0), (4, 1017, 1, 0),
    (4, 1018, 1, 0), (4, 1020, 3, 0), (4, 1022, 2, 0), (4, 1024, 2, 1),
    (5, 1015, 5, 0), (5, 1016, 5, 1), (5, 1017, 4, 1),
    (5, 1018, 3, 0), (5, 1019, 6, 0), (5, 1020, 4, 0),
    (5, 1021, 18, 1), (5, 1022, 3, 0), (5, 1023, 5, 0), (5, 1024, 2, 0);

INSERT INTO promotions (promotion_id, product_id, promotion_name, discount_percent, starts_on, ends_on, is_active) VALUES
    (201, 1001, 'Practice Season Offer', 10, '2026-10-01', '2026-12-15', 1),
    (202, 1007, 'Quiet Room Studio Event', 15, '2026-10-15', '2026-11-30', 1),
    (203, 1005, 'Lantern Festival Price', 8, '2026-08-01', '2026-08-31', 0),
    (204, 1010, 'Recording Week', 12, '2026-11-10', '2026-11-20', 0),
    (205, 1014, 'Starter Percussion Bundle', 5, '2026-10-01', '2026-12-31', 1),
    (206, 1015, 'Small Instrument Discovery Offer', 5, '2026-11-01', '2026-12-05', 1),
    (207, 1019, 'Studio Listening Days', 10, '2026-11-08', '2026-12-10', 1),
    (208, 1016, 'Extended Range Event', 12, '2026-11-20', '2026-12-04', 0),
    (209, 1023, 'Community Stage Offer', 8, '2026-11-01', '2026-11-30', 1),
    (210, 1024, 'First Notes Promotion', 7, '2026-09-01', '2026-09-30', 0);

INSERT INTO customers (customer_id, customer_name, email, home_city, home_region, account_status) VALUES
    (1, 'Mira Fen', 'mira.fen@example.invalid', 'Lyravale', 'Bellwether', 'active'),
    (2, 'Tomas Reed', 'tomas.reed@example.invalid', 'Ashmere', 'Northfen', 'active'),
    (3, 'Ilyan Vale', 'ilyan.vale@example.invalid', 'Lyravale', 'Bellwether', 'active'),
    (4, 'Nessa Brook', 'nessa.brook@example.invalid', 'Thornfield', 'Greymarch', 'active'),
    (5, 'Oren Wren', 'oren.wren@example.invalid', 'Lyravale', 'Bellwether', 'active'),
    (6, 'Sela Hart', 'sela.hart@example.invalid', 'Silvermere', 'Westreach', 'closed'),
    (7, 'Perrin Moss', 'perrin.moss@example.invalid', 'Ashmere', 'Northfen', 'active'),
    (8, 'Liora Cade', 'liora.cade@example.invalid', 'Highmere', 'Eastvale', 'active'),
    (9, 'Edda Rowan', 'edda.rowan@example.invalid', 'Stonehaven', 'Highmarch', 'active'),
    (10, 'Cael Sutter', 'cael.sutter@example.invalid', 'Wrenford', 'Elmsward', 'active'),
    (11, 'Brenna Pike', 'brenna.pike@example.invalid', 'Ashmere', 'Northfen', 'active'),
    (12, 'Dorian Flint', 'dorian.flint@example.invalid', 'Lyravale', 'Bellwether', 'active'),
    (13, 'Lysa Quill', 'lysa.quill@example.invalid', 'Dunmere', 'Redvale', 'active'),
    (14, 'Halden Crane', 'halden.crane@example.invalid', 'Thornfield', 'Greymarch', 'active'),
    (15, 'Iona Lark', 'iona.lark@example.invalid', 'Silvermere', 'Westreach', 'active'),
    (16, 'Fenn Alder', 'fenn.alder@example.invalid', 'Highmere', 'Eastvale', 'closed'),
    (17, 'Mara Sol', 'mara.sol@example.invalid', 'Stonehaven', 'Highmarch', 'active'),
    (18, 'Orin Bell', 'orin.bell@example.invalid', 'Wrenford', 'Elmsward', 'active');

INSERT INTO orders (
    order_id, customer_id, order_date, order_status, payment_status, payment_method,
    sales_channel, fulfillment_location_id, fulfillment_method, tracking_code,
    estimated_delivery, subtotal, discount_total, shipping_fee, order_total, notes
) VALUES
    ('SON-1041', 1, '2026-10-20', 'delivered', 'paid', 'card_installments', 'online', 2, 'delivery', 'EL-SH-4101', '2026-10-27', 268.00, 24.90, 12.00, 255.10, 'Acoustic guitar promotion applied at checkout.'),
    ('SON-1042', 2, '2026-11-02', 'processing', 'paid', 'sonora_transfer', 'online', 5, 'delivery', NULL, '2026-11-12', 508.00, 0.00, 15.00, 523.00, 'Awaiting the next picking cycle.'),
    ('SON-1043', 3, '2026-10-28', 'delivered', 'paid', 'bank_slip', 'online', 2, 'delivery', 'EL-SH-4103', '2026-11-04', 699.00, 0.00, 0.00, 699.00, 'Economy delivery was free at the displayed threshold.'),
    ('SON-1044', 4, '2026-11-01', 'in_transit', 'paid', 'card_installments', 'online', 4, 'delivery', 'EL-SH-4104', '2026-11-10', 238.00, 0.00, 12.00, 250.00, 'Tracking shows the parcel moving through the regional hub.'),
    ('SON-1045', 5, '2026-11-05', 'awaiting_payment', 'pending', 'bank_slip', 'online', 2, 'delivery', NULL, '2026-11-17', 288.00, 0.00, 12.00, 300.00, 'Picking begins after payment is recognized.'),
    ('SON-1046', 6, '2026-10-18', 'cancelled', 'refunded', 'sonora_transfer', 'online', 2, 'delivery', NULL, NULL, 579.00, 0.00, 15.00, 594.00, 'Canceled before dispatch; the payment was refunded.'),
    ('SON-1047', 7, '2026-10-25', 'delivered', 'paid', 'card_installments', 'online', 2, 'delivery', 'EL-SH-4107', '2026-11-01', 338.00, 47.85, 12.00, 302.15, 'Studio monitor promotion applied; cable remained at regular price.'),
    ('SON-1048', 8, '2026-10-30', 'delivered', 'paid', 'sonora_transfer', 'online', 5, 'delivery', 'EL-SH-4108', '2026-11-06', 118.00, 0.00, 12.00, 130.00, 'Two protective cases shipped together.'),
    ('SON-1049', 1, '2026-11-03', 'processing', 'paid', 'card_installments', 'online', 5, 'delivery', NULL, '2026-11-13', 217.00, 0.00, 12.00, 229.00, 'Includes two instrument cables.'),
    ('SON-1050', 2, '2026-11-04', 'delivered', 'paid', 'card_installments', 'in_store', 3, 'pickup', NULL, NULL, 699.00, 0.00, 0.00, 699.00, 'Purchased and collected at the Ashmere Pickup Studio.'),
    ('SON-1051', 3, '2026-10-22', 'delivered', 'paid', 'bank_slip', 'online', 2, 'delivery', 'EL-SH-4111', '2026-10-29', 267.00, 0.00, 12.00, 279.00, 'Three microphones for a rehearsal room.'),
    ('SON-1052', 4, '2026-11-06', 'processing', 'paid', 'sonora_transfer', 'online', 4, 'delivery', NULL, '2026-11-16', 76.00, 0.00, 12.00, 88.00, 'Four instrument cables in one parcel.'),
    ('SON-1053', 9, '2026-11-01', 'delivered', 'paid', 'card_installments', 'online', 2, 'delivery', 'EL-SH-4153', '2026-11-07', 138.00, 5.95, 12.00, 144.05, 'The ukulele offer was applied to the eligible item.'),
    ('SON-1054', 10, '2026-11-02', 'processing', 'paid', 'sonora_transfer', 'online', 5, 'delivery', NULL, '2026-11-14', 429.00, 0.00, 15.00, 444.00, 'Five-string bass is being prepared at the forwarding depot.'),
    ('SON-1055', 11, '2026-11-02', 'delivered', 'paid', 'card_installments', 'in_store', 3, 'pickup', NULL, NULL, 139.00, 0.00, 0.00, 139.00, 'Purchased and collected at the Ashmere Pickup Studio.'),
    ('SON-1056', 12, '2026-11-01', 'in_transit', 'paid', 'bank_slip', 'online', 2, 'delivery', 'EL-SH-4156', '2026-11-09', 143.00, 0.00, 12.00, 155.00, 'Headphones and a compact microphone stand shipped together.'),
    ('SON-1057', 13, '2026-11-06', 'awaiting_payment', 'pending', 'sonora_transfer', 'online', 5, 'delivery', NULL, '2026-11-18', 399.00, 0.00, 12.00, 411.00, 'Payment is not yet confirmed; stock is not reserved.'),
    ('SON-1058', 14, '2026-10-27', 'cancelled', 'refunded', 'card_installments', 'online', 4, 'delivery', NULL, NULL, 189.00, 0.00, 12.00, 201.00, 'Customer canceled before dispatch; card reversal was requested.'),
    ('SON-1059', 14, '2026-11-03', 'ready_for_pickup', 'paid', 'bank_slip', 'online', 4, 'pickup', NULL, '2026-11-10', 189.00, 0.00, 0.00, 189.00, 'Clarinet outfit is ready at the Thornfield Service Counter.'),
    ('SON-1060', 16, '2026-08-05', 'delivered', 'paid', 'card_installments', 'online', 2, 'delivery', 'EL-SH-4160', '2026-08-12', 49.00, 0.00, 12.00, 61.00, 'Historic order retained after the customer closed the account.'),
    ('SON-1061', 17, '2026-10-31', 'delivered', 'paid', 'sonora_transfer', 'online', 2, 'delivery', 'EL-SH-4161', '2026-11-06', 72.00, 0.00, 12.00, 84.00, 'Three patch cables shipped in one parcel.'),
    ('SON-1062', 18, '2026-11-04', 'processing', 'paid', 'card_installments', 'online', 5, 'delivery', NULL, '2026-11-15', 218.00, 0.00, 12.00, 230.00, 'Percussion pad and protective case are being picked.'),
    ('SON-1063', 9, '2026-10-24', 'delivered', 'paid', 'bank_slip', 'online', 4, 'delivery', 'EL-SH-4163', '2026-10-31', 189.00, 0.00, 12.00, 201.00, 'A student clarinet outfit with a care kit.'),
    ('SON-1064', 10, '2026-10-29', 'delivered', 'paid', 'card_installments', 'in_store', 3, 'pickup', NULL, NULL, 429.00, 0.00, 0.00, 429.00, 'Collected at the Ashmere Pickup Studio.'),
    ('SON-1065', 11, '2026-11-05', 'in_transit', 'paid', 'card_installments', 'online', 5, 'delivery', 'EL-SH-4165', '2026-11-13', 399.00, 31.92, 12.00, 379.08, 'Community Stage promotion applied to the speaker.'),
    ('SON-1066', 12, '2026-11-06', 'delivered', 'paid', 'sonora_transfer', 'online', 4, 'delivery', 'EL-SH-4166', '2026-11-07', 158.00, 5.95, 12.00, 164.05, 'Includes a discounted ukulele and a remaining-stock stand.'),
    ('SON-1067', 13, '2026-11-06', 'processing', 'paid', 'sonora_transfer', 'online', 5, 'delivery', NULL, '2026-11-16', 188.00, 0.00, 12.00, 200.00, 'MIDI controller and tuner pedal are being prepared.');

INSERT INTO order_items (
    order_item_id, order_id, product_id, quantity, unit_price_at_purchase,
    line_subtotal, discount_amount, line_total
) VALUES
    (1, 'SON-1041', 1001, 1, 249.00, 249.00, 24.90, 224.10),
    (2, 'SON-1041', 1012, 1, 19.00, 19.00, 0.00, 19.00),
    (3, 'SON-1042', 1002, 1, 489.00, 489.00, 0.00, 489.00),
    (4, 'SON-1042', 1012, 1, 19.00, 19.00, 0.00, 19.00),
    (5, 'SON-1043', 1004, 1, 699.00, 699.00, 0.00, 699.00),
    (6, 'SON-1044', 1008, 1, 149.00, 149.00, 0.00, 149.00),
    (7, 'SON-1044', 1009, 1, 89.00, 89.00, 0.00, 89.00),
    (8, 'SON-1045', 1005, 1, 229.00, 229.00, 0.00, 229.00),
    (9, 'SON-1045', 1011, 1, 59.00, 59.00, 0.00, 59.00),
    (10, 'SON-1046', 1006, 1, 579.00, 579.00, 0.00, 579.00),
    (11, 'SON-1047', 1007, 1, 319.00, 319.00, 47.85, 271.15),
    (12, 'SON-1047', 1012, 1, 19.00, 19.00, 0.00, 19.00),
    (13, 'SON-1048', 1011, 2, 59.00, 118.00, 0.00, 118.00),
    (14, 'SON-1049', 1010, 1, 179.00, 179.00, 0.00, 179.00),
    (15, 'SON-1049', 1012, 2, 19.00, 38.00, 0.00, 38.00),
    (16, 'SON-1050', 1004, 1, 699.00, 699.00, 0.00, 699.00),
    (17, 'SON-1051', 1009, 3, 89.00, 267.00, 0.00, 267.00),
    (18, 'SON-1052', 1012, 4, 19.00, 76.00, 0.00, 76.00),
    (19, 'SON-1053', 1015, 1, 119.00, 119.00, 5.95, 113.05),
    (20, 'SON-1053', 1012, 1, 19.00, 19.00, 0.00, 19.00),
    (21, 'SON-1054', 1016, 1, 429.00, 429.00, 0.00, 429.00),
    (22, 'SON-1055', 1018, 1, 139.00, 139.00, 0.00, 139.00),
    (23, 'SON-1056', 1019, 1, 109.00, 109.00, 0.00, 109.00),
    (24, 'SON-1056', 1020, 1, 34.00, 34.00, 0.00, 34.00),
    (25, 'SON-1057', 1023, 1, 399.00, 399.00, 0.00, 399.00),
    (26, 'SON-1058', 1024, 1, 189.00, 189.00, 0.00, 189.00),
    (27, 'SON-1059', 1024, 1, 189.00, 189.00, 0.00, 189.00),
    (28, 'SON-1060', 1022, 1, 49.00, 49.00, 0.00, 49.00),
    (29, 'SON-1061', 1021, 3, 24.00, 72.00, 0.00, 72.00),
    (30, 'SON-1062', 1017, 1, 159.00, 159.00, 0.00, 159.00),
    (31, 'SON-1062', 1011, 1, 59.00, 59.00, 0.00, 59.00),
    (32, 'SON-1063', 1024, 1, 189.00, 189.00, 0.00, 189.00),
    (33, 'SON-1064', 1016, 1, 429.00, 429.00, 0.00, 429.00),
    (34, 'SON-1065', 1023, 1, 399.00, 399.00, 31.92, 367.08),
    (35, 'SON-1066', 1015, 1, 119.00, 119.00, 5.95, 113.05),
    (36, 'SON-1066', 1013, 1, 39.00, 39.00, 0.00, 39.00),
    (37, 'SON-1067', 1018, 1, 139.00, 139.00, 0.00, 139.00),
    (38, 'SON-1067', 1022, 1, 49.00, 49.00, 0.00, 49.00);

INSERT INTO service_cases (
    case_id, customer_id, order_id, opened_on, case_type, case_status, summary, resolution
) VALUES
    ('CASE-301', 1, 'SON-1041', '2026-10-29', 'product_support', 'waiting_for_customer', 'Customer asked how to adjust the guitar neck after delivery.', 'Sent the setup guide and offered an appointment; awaiting the preferred visit time.'),
    ('CASE-302', 4, 'SON-1044', '2026-11-06', 'delivery_question', 'open', 'Customer asked for an update on the in-transit parcel.', ''),
    ('CASE-303', 6, 'SON-1046', '2026-10-18', 'return_request', 'resolved', 'Customer requested cancellation before dispatch.', 'Order was canceled and the payment refund was recorded.'),
    ('CASE-304', 2, 'SON-1042', '2026-11-03', 'payment_question', 'resolved', 'Customer asked whether the transfer had been matched to the order.', 'Payment was matched and the order remained in the processing queue.'),
    ('CASE-305', 9, 'SON-1053', '2026-11-03', 'product_support', 'resolved', 'Customer asked whether the ukulele uses nylon or steel strings.', 'Confirmed that the instrument uses nylon strings.'),
    ('CASE-306', 10, 'SON-1054', '2026-11-04', 'delivery_question', 'waiting_for_customer', 'Customer requested delivery to a staffed pickup point.', 'Sent available pickup options and requested a selection.'),
    ('CASE-307', 11, 'SON-1055', '2026-11-02', 'product_support', 'resolved', 'Customer asked how to connect the MIDI controller to a laptop.', 'Shared the connection guide and compatibility checklist.'),
    ('CASE-308', 12, 'SON-1056', '2026-11-07', 'delivery_question', 'open', 'Customer asked for the latest tracking event.', ''),
    ('CASE-309', 13, 'SON-1057', '2026-11-06', 'payment_question', 'open', 'Customer says the transfer was sent but the order still shows awaiting payment.', ''),
    ('CASE-310', 14, 'SON-1058', '2026-10-27', 'return_request', 'resolved', 'Customer canceled the clarinet order before it was dispatched.', 'Order was canceled and the card reversal was requested.'),
    ('CASE-311', 14, 'SON-1059', '2026-11-07', 'delivery_question', 'resolved', 'Customer asked where to collect the clarinet outfit.', 'Confirmed the Thornfield Service Counter pickup address and opening hours.'),
    ('CASE-312', 16, 'SON-1060', '2026-08-14', 'payment_question', 'resolved', 'Customer requested a receipt for a past order after closing the account.', 'Sent the receipt through the verified contact channel.');

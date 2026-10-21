CREATE TABLE work_categories (
  id text PRIMARY KEY,
  parent_id text REFERENCES work_categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  active boolean NOT NULL DEFAULT true,
  selectable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_categories_id_slug CHECK (id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT work_categories_name_nonblank CHECK (length(btrim(name)) > 0),
  CONSTRAINT work_categories_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX work_categories_active_tree
  ON work_categories (parent_id, sort_order, name, id)
  WHERE active = true;

INSERT INTO work_categories (id, parent_id, name, sort_order, selectable) VALUES
  ('construction', NULL, 'Строительство', 10, false),
  ('renovation', NULL, 'Ремонт и отделка', 20, false),
  ('services', NULL, 'Бытовые и строительные услуги', 30, false),

  ('house-building', 'construction', 'Строительство домов и коттеджей', 10, true),
  ('log-house-building', 'construction', 'Строительство срубов', 20, true),
  ('bath-sauna-building', 'construction', 'Строительство бань и саун', 30, true),
  ('prefabricated-houses', 'construction', 'Быстровозводимые дома', 40, true),
  ('foundation', 'construction', 'Фундаменты', 50, true),
  ('concrete-work', 'construction', 'Бетонные работы', 60, true),
  ('masonry', 'construction', 'Каменные и кирпичные работы', 70, true),
  ('walls-partitions', 'construction', 'Стены и перегородки', 80, true),
  ('stoves-fireplaces', 'construction', 'Печи и камины', 90, true),
  ('stairs', 'construction', 'Лестницы', 100, true),
  ('facade-work', 'construction', 'Фасадные работы', 110, true),
  ('roofing', 'construction', 'Кровельные работы', 120, true),
  ('pools', 'construction', 'Строительство бассейнов', 130, true),
  ('welding', 'construction', 'Сварочные работы', 140, true),
  ('excavation', 'construction', 'Земляные работы', 150, true),
  ('waterproofing', 'construction', 'Гидроизоляция', 160, true),
  ('well-drilling', 'construction', 'Бурение скважин', 170, true),
  ('fences', 'construction', 'Заборы и ограждения', 180, true),
  ('roads', 'construction', 'Строительство дорог', 190, true),
  ('landscape-design', 'construction', 'Ландшафтный дизайн', 200, true),
  ('architecture', 'construction', 'Архитектурные услуги', 210, true),

  ('apartment-renovation', 'renovation', 'Ремонт квартиры', 10, true),
  ('kitchen-renovation', 'renovation', 'Ремонт кухни', 20, true),
  ('bathroom-renovation', 'renovation', 'Ремонт ванной и санузла', 30, true),
  ('office-renovation', 'renovation', 'Ремонт офиса', 40, true),
  ('floor-screed', 'renovation', 'Стяжка и выравнивание пола', 50, true),
  ('floor-coverings', 'renovation', 'Напольные покрытия', 60, true),
  ('tiling', 'renovation', 'Укладка плитки', 70, true),
  ('plaster-painting', 'renovation', 'Малярные и штукатурные работы', 80, true),
  ('drywall', 'renovation', 'Монтаж гипсокартона', 90, true),
  ('doors', 'renovation', 'Установка дверей', 100, true),
  ('windows-glazing', 'renovation', 'Окна, остекление и откосы', 110, true),
  ('wallpaper', 'renovation', 'Поклейка обоев', 120, true),
  ('ceilings', 'renovation', 'Монтаж и отделка потолков', 130, true),
  ('electrical', 'renovation', 'Электромонтажные работы', 140, true),
  ('plumbing', 'renovation', 'Сантехнические работы', 150, true),
  ('interior-design', 'renovation', 'Дизайн интерьера', 160, true),
  ('decor-making', 'renovation', 'Изготовление декора', 170, true),

  ('handyman', 'services', 'Мастер на час', 10, true),
  ('appliance-installation', 'services', 'Подключение бытовой техники', 20, true),
  ('lock-installation', 'services', 'Установка и замена замков', 30, true),
  ('cleaning', 'services', 'Уборка помещений', 40, true),
  ('furniture', 'services', 'Изготовление и сборка мебели', 50, true),
  ('carpentry', 'services', 'Столярные и плотницкие работы', 60, true),
  ('construction-machinery-rental', 'services', 'Аренда строительной техники', 70, true),
  ('equipment-rental', 'services', 'Аренда оборудования', 80, true),
  ('transportation', 'services', 'Перевозки', 90, true);

CREATE TABLE work_category_legacy_refs (
  source text NOT NULL CHECK (source IN ('projects', 'freelancers')),
  legacy_id integer NOT NULL CHECK (legacy_id > 0),
  category_id text NOT NULL REFERENCES work_categories(id) ON DELETE RESTRICT,
  PRIMARY KEY (source, legacy_id)
);

CREATE INDEX work_category_legacy_refs_category
  ON work_category_legacy_refs (category_id);

INSERT INTO work_category_legacy_refs (source, legacy_id, category_id) VALUES
  ('projects', 1, 'house-building'),
  ('projects', 2, 'handyman'),
  ('projects', 3, 'apartment-renovation'),
  ('projects', 4, 'floor-screed'),
  ('projects', 5, 'floor-coverings'),
  ('projects', 6, 'foundation'),
  ('projects', 7, 'log-house-building'),
  ('projects', 8, 'bath-sauna-building'),
  ('projects', 9, 'house-building'),
  ('projects', 14, 'tiling'),
  ('projects', 15, 'plaster-painting'),
  ('projects', 16, 'drywall'),
  ('projects', 17, 'doors'),
  ('projects', 18, 'windows-glazing'),
  ('projects', 19, 'wallpaper'),
  ('projects', 20, 'ceilings'),
  ('projects', 21, 'electrical'),
  ('projects', 22, 'plumbing'),
  ('projects', 23, 'kitchen-renovation'),
  ('projects', 24, 'bathroom-renovation'),
  ('projects', 25, 'prefabricated-houses'),
  ('projects', 26, 'concrete-work'),
  ('projects', 27, 'masonry'),
  ('projects', 28, 'walls-partitions'),
  ('projects', 29, 'stoves-fireplaces'),
  ('projects', 30, 'stairs'),
  ('projects', 31, 'windows-glazing'),
  ('projects', 32, 'facade-work'),
  ('projects', 33, 'roofing'),
  ('projects', 34, 'pools'),
  ('projects', 35, 'welding'),
  ('projects', 36, 'excavation'),
  ('projects', 37, 'well-drilling'),
  ('projects', 38, 'fences'),
  ('projects', 39, 'landscape-design'),
  ('projects', 40, 'fences'),
  ('projects', 41, 'roads'),
  ('projects', 42, 'services'),

  ('freelancers', 1, 'construction'),
  ('freelancers', 2, 'construction'),
  ('freelancers', 3, 'interior-design'),
  ('freelancers', 51, 'renovation'),
  ('freelancers', 54, 'renovation'),
  ('freelancers', 86, 'log-house-building'),
  ('freelancers', 87, 'bath-sauna-building'),
  ('freelancers', 88, 'house-building'),
  ('freelancers', 89, 'renovation'),
  ('freelancers', 90, 'apartment-renovation'),
  ('freelancers', 91, 'kitchen-renovation'),
  ('freelancers', 92, 'bathroom-renovation'),
  ('freelancers', 93, 'office-renovation'),
  ('freelancers', 94, 'floor-screed'),
  ('freelancers', 95, 'floor-coverings'),
  ('freelancers', 96, 'tiling'),
  ('freelancers', 97, 'plaster-painting'),
  ('freelancers', 98, 'doors'),
  ('freelancers', 99, 'windows-glazing'),
  ('freelancers', 100, 'wallpaper'),
  ('freelancers', 101, 'plaster-painting'),
  ('freelancers', 102, 'electrical'),
  ('freelancers', 103, 'plumbing'),
  ('freelancers', 104, 'decor-making'),
  ('freelancers', 105, 'walls-partitions'),
  ('freelancers', 106, 'ceilings'),
  ('freelancers', 107, 'interior-design'),
  ('freelancers', 108, 'prefabricated-houses'),
  ('freelancers', 109, 'foundation'),
  ('freelancers', 110, 'concrete-work'),
  ('freelancers', 111, 'masonry'),
  ('freelancers', 112, 'stoves-fireplaces'),
  ('freelancers', 113, 'stairs'),
  ('freelancers', 114, 'facade-work'),
  ('freelancers', 115, 'roofing'),
  ('freelancers', 116, 'pools'),
  ('freelancers', 117, 'welding'),
  ('freelancers', 118, 'excavation'),
  ('freelancers', 119, 'waterproofing'),
  ('freelancers', 120, 'well-drilling'),
  ('freelancers', 121, 'fences'),
  ('freelancers', 122, 'roads'),
  ('freelancers', 123, 'landscape-design'),
  ('freelancers', 124, 'architecture'),
  ('freelancers', 125, 'services'),
  ('freelancers', 126, 'handyman'),
  ('freelancers', 127, 'appliance-installation'),
  ('freelancers', 128, 'lock-installation'),
  ('freelancers', 129, 'cleaning'),
  ('freelancers', 130, 'furniture'),
  ('freelancers', 131, 'carpentry'),
  ('freelancers', 132, 'construction-machinery-rental'),
  ('freelancers', 133, 'equipment-rental'),
  ('freelancers', 134, 'transportation');

CREATE TABLE contractor_profile_specializations (
  account_id uuid NOT NULL REFERENCES contractor_profiles(account_id) ON DELETE CASCADE,
  category_id text NOT NULL REFERENCES work_categories(id) ON DELETE RESTRICT,
  PRIMARY KEY (account_id, category_id)
);

CREATE INDEX contractor_profile_specializations_category
  ON contractor_profile_specializations (category_id, account_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM contractor_profiles cp
    CROSS JOIN LATERAL jsonb_array_elements_text(cp.specialization_ids) AS legacy(category_id)
    LEFT JOIN work_categories wc ON wc.id = legacy.category_id
    WHERE wc.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Existing contractor profiles contain unknown work category IDs';
  END IF;
END $$;

INSERT INTO contractor_profile_specializations (account_id, category_id)
SELECT cp.account_id, legacy.category_id
FROM contractor_profiles cp
CROSS JOIN LATERAL jsonb_array_elements_text(cp.specialization_ids) AS legacy(category_id);

ALTER TABLE contractor_profiles DROP COLUMN specialization_ids;

ALTER TABLE orders
  ADD CONSTRAINT orders_category_fk
  FOREIGN KEY (category_id) REFERENCES work_categories(id) NOT VALID;

ALTER TABLE order_submissions
  ADD CONSTRAINT order_submissions_category_fk
  FOREIGN KEY (category_id) REFERENCES work_categories(id) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM orders o
    LEFT JOIN work_categories wc ON wc.id = o.category_id
    WHERE wc.id IS NULL
  ) THEN
    ALTER TABLE orders VALIDATE CONSTRAINT orders_category_fk;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM order_submissions os
    LEFT JOIN work_categories wc ON wc.id = os.category_id
    WHERE wc.id IS NULL
  ) THEN
    ALTER TABLE order_submissions VALIDATE CONSTRAINT order_submissions_category_fk;
  END IF;
END $$;

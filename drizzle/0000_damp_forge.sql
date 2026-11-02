CREATE TABLE `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`input_summary` text NOT NULL,
	`output_summary` text DEFAULT '' NOT NULL,
	`tool_summary` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runs_owner_created` ON `agent_runs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `connectors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`endpoint` text NOT NULL,
	`method` text DEFAULT 'GET' NOT NULL,
	`auth_mode` text DEFAULT 'none' NOT NULL,
	`secret_ref` text,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_connectors_owner_updated` ON `connectors` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `memories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`namespace` text NOT NULL,
	`content` text NOT NULL,
	`source` text DEFAULT 'operator' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_memories_owner_namespace` ON `memories` (`owner_id`,`namespace`);
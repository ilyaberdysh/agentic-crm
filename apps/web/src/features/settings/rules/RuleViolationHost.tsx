// "Updates required" (BACKLOG 6.06 acceptance 4; A §4.13): a write a requirement rule refused is held by the mutation
// queue (its value stays visible) and this dialog lists the rules it breaks with their messages. Discard drops the
// change; "Try again" sends it once more (after fixing what the rules ask for elsewhere); "Keep editing" leaves it held.
import { Button, DialogBody, DialogFooter, DialogHeader, Icon, Modal, toast } from '@agentic-crm/ui';
import { useEffect } from 'react';
import { setHoldHandler } from '../../../data/mutations';
import { useAttributes } from '../../attributes/data/queries';
import * as r from './rules.css';
import {
  closeViolation,
  distinctViolations,
  type HeldWrite,
  holdWrite,
  reopenViolation,
  resolveViolation,
  useOpenViolation,
  violationsOf,
} from './violations';

export function RuleViolationHost() {
  const open = useOpenViolation();
  useEffect(() => {
    setHoldHandler((write, error, ctx) => holdWrite({ id: write.id, write, violations: violationsOf(error), ctx }));
    return () => setHoldHandler(null);
  }, []);
  return open ? <ViolationDialog item={open} /> : null;
}

function ViolationDialog({ item }: { item: HeldWrite }) {
  const violations = distinctViolations(item.violations);
  const { attributes } = useAttributes(violations[0]?.entity_definition_id);
  const titleOf = (id: string) => attributes.find((a) => a.id === id)?.title ?? 'Attribute';
  const rules = [...new Set(violations.map((v) => v.rule_name))];

  const keepEditing = () => {
    closeViolation();
    toast.warning({
      title: 'Your change is on hold',
      description: 'It does not meet the requirements of this object yet.',
      action: { label: 'Review', onAction: () => reopenViolation(item.id) },
      durationMs: 12_000,
    });
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => !open && keepEditing()}
      size="medium"
      aria-label="Updates required"
      overlay
      isDismissable={false}
    >
      <DialogHeader
        title="Updates required"
        icon={<Icon icon="warning" size={16} color="warning" />}
        onClose={keepEditing}
      />
      <DialogBody className={r.violationBody}>
        <p className={r.violationIntro}>
          This change cannot be saved yet. It does not meet{' '}
          {rules.length === 1 ? 'a requirement rule' : 'these requirement rules'}:
        </p>
        <ul className={r.violationList} data-testid="rule-violations">
          {violations.map((v) => (
            <li
              key={`${v.particle_gate_id}|${v.particle_gate_validation_rule_id}|${v.message}`}
              className={r.violationItem}
            >
              <span className={r.violationRule}>{v.rule_name}</span>
              <span className={r.violationMessage}>
                {titleOf(v.attribute_definition_id)}: {v.message}
              </span>
            </li>
          ))}
        </ul>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="secondary-destructive"
          size={28}
          onPress={() => {
            item.ctx.discard();
            resolveViolation(item.id);
          }}
        >
          Discard change
        </Button>
        <Button variant="secondary" size={28} onPress={keepEditing}>
          Keep editing
        </Button>
        <Button
          variant="primary"
          size={28}
          onPress={() => {
            resolveViolation(item.id);
            item.ctx.retry();
          }}
        >
          Try again
        </Button>
      </DialogFooter>
    </Modal>
  );
}
